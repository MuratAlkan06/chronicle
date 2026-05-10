/**
 * Chronicle — useExtractionStream
 *
 * Reducer-driven SSE consumer for `POST /api/extract` (per API.md + BACKEND-
 * STANDARDS.md §J.2). Two request shapes share the hook:
 *  - `{ caseId }` JSON           → cached replay (1.5s feel-delay per doc)
 *  - `FormData` with `files[]`   → live extraction
 *
 * Per resolved decision #5: events frames are drained through a 150ms leaky-
 * bucket so a fast-arriving burst still feels like cards landing one at a time.
 * Doc-level frames (started / doc_started / doc_complete / doc_error / done)
 * pass through without throttling so the badge counter stays responsive.
 *
 * Events are kept date-sorted (asc) on every reducer dispatch so the rendered
 * list is monotone — Framer Motion's `layout` then animates each insertion
 * into its chronological slot.
 */
"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { TimelineEventSchema, type SseFrame, type TimelineEvent } from "@/lib/schema";

const FLUSH_INTERVAL_MS = 150;

export type ExtractionStatus =
  | "idle"
  | "extracting"
  | "done"
  | "error";

export interface DocProgress {
  docId: string;
  filename: string;
  status: "pending" | "complete" | "error";
  eventCount: number;
  error?: string;
}

export interface ExtractionError {
  code: string;
  message: string;
  retryable: boolean;
}

export type ExtractionMode = "live" | "cached";

export interface ExtractionState {
  status: ExtractionStatus;
  events: TimelineEvent[];
  docs: DocProgress[];
  totalDocs: number;
  error: ExtractionError | null;
  /** Set when the active stream is replaying a cached preset case. */
  caseId: "case1" | "case2" | "case3" | null;
  mode: ExtractionMode | null;
}

const initialState: ExtractionState = {
  status: "idle",
  events: [],
  docs: [],
  totalDocs: 0,
  error: null,
  caseId: null,
  mode: null,
};

type Action =
  | { type: "reset" }
  | { type: "begin"; mode: ExtractionMode; caseId: ExtractionState["caseId"] }
  | { type: "frame"; frame: SseFrame }
  | { type: "events_batch"; events: TimelineEvent[] }
  | { type: "fail"; error: ExtractionError };

function reducer(state: ExtractionState, action: Action): ExtractionState {
  switch (action.type) {
    case "reset":
      return initialState;
    case "begin":
      return {
        ...initialState,
        status: "extracting",
        mode: action.mode,
        caseId: action.caseId,
      };
    case "events_batch": {
      if (action.events.length === 0) return state;
      const merged = [...state.events];
      for (const ev of action.events) {
        if (merged.some((m) => m.id === ev.id)) continue;
        merged.push(ev);
      }
      merged.sort(compareEvents);
      // Update per-doc counter so the badge stays in sync without waiting
      // for doc_complete (which still sets the authoritative count).
      const counted = new Map<string, number>();
      for (const ev of action.events) {
        counted.set(ev.source.document_id, (counted.get(ev.source.document_id) ?? 0) + 1);
      }
      const docs = state.docs.map((d) => {
        const inc = counted.get(d.docId);
        return inc ? { ...d, eventCount: d.eventCount + inc } : d;
      });
      return { ...state, events: merged, docs };
    }
    case "frame": {
      const f = action.frame;
      switch (f.type) {
        case "started":
          return state;
        case "doc_started": {
          const exists = state.docs.some((d) => d.docId === f.docId);
          const docs = exists
            ? state.docs
            : [
                ...state.docs,
                {
                  docId: f.docId,
                  filename: f.filename,
                  status: "pending" as const,
                  eventCount: 0,
                },
              ];
          return { ...state, docs, totalDocs: f.totalDocs };
        }
        case "doc_complete":
          return {
            ...state,
            docs: state.docs.map((d) =>
              d.docId === f.docId
                ? { ...d, status: "complete" as const, eventCount: f.eventCount }
                : d,
            ),
          };
        case "doc_error":
          return {
            ...state,
            docs: state.docs.map((d) =>
              d.docId === f.docId
                ? { ...d, status: "error" as const, error: f.message }
                : d,
            ),
          };
        case "error":
          return {
            ...state,
            status: "error",
            error: { code: f.code, message: f.message, retryable: f.retryable },
          };
        case "done":
          return { ...state, status: "done" };
        default:
          return state;
      }
    }
    case "fail":
      return { ...state, status: "error", error: action.error };
    default:
      return state;
  }
}

function compareEvents(a: TimelineEvent, b: TimelineEvent): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return a.id.localeCompare(b.id);
}

export interface StartOptions {
  caseId?: "case1" | "case2" | "case3";
  files?: File[];
}

export function useExtractionStream() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<TimelineEvent[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ad-hoc dropped PDFs are kept in-memory by docId so the side panel can
  // render the source even after the SSE stream completes. Cleared on reset.
  const filesRef = useRef<Map<string, File>>(new Map());

  const flushQueue = useCallback(() => {
    flushTimerRef.current = null;
    const batch = queueRef.current;
    if (batch.length === 0) return;
    queueRef.current = [];
    dispatch({ type: "events_batch", events: batch });
  }, []);

  const enqueueEvent = useCallback(
    (event: TimelineEvent) => {
      queueRef.current.push(event);
      if (flushTimerRef.current === null) {
        // Leak one frame's worth on the next 150ms tick.
        flushTimerRef.current = setTimeout(flushQueue, FLUSH_INTERVAL_MS);
      }
    },
    [flushQueue],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    queueRef.current = [];
    filesRef.current.clear();
    dispatch({ type: "reset" });
  }, []);

  /** Look up an in-memory File by its dropfile-derived docId. Returns null
   * for cached/preset cases — caller should fetch from the cases route. */
  const getDroppedFile = useCallback(
    (docId: string): File | null => filesRef.current.get(docId) ?? null,
    [],
  );

  const start = useCallback(
    async (opts: StartOptions) => {
      // Cancel any in-flight stream before kicking a new one off.
      abortRef.current?.abort();
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      queueRef.current = [];
      filesRef.current.clear();
      // Stash dropped files keyed on the same docId convention the route
      // handler emits (filename minus .pdf, case-insensitive).
      if (opts.files) {
        for (const f of opts.files) {
          filesRef.current.set(stripPdfExt(f.name), f);
        }
      }
      dispatch({
        type: "begin",
        mode: opts.caseId ? "cached" : "live",
        caseId: opts.caseId ?? null,
      });

      const controller = new AbortController();
      abortRef.current = controller;

      let response: Response;
      try {
        response = await fetch("/api/extract", buildRequest(opts, controller.signal));
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        dispatch({
          type: "fail",
          error: { code: "network", message, retryable: true },
        });
        return;
      }

      if (!response.ok || !response.body) {
        const error = await readErrorEnvelope(response);
        dispatch({ type: "fail", error });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = drainFrames(buffer);
          buffer = frames.remainder;
          for (const raw of frames.payloads) {
            const frame = safeParseFrame(raw);
            if (!frame) continue;
            if (frame.type === "event") {
              enqueueEvent(frame.event);
            } else {
              // Flush the pending event queue before any structural frame so
              // doc_complete arrives after its events have landed.
              if (queueRef.current.length > 0) flushQueue();
              dispatch({ type: "frame", frame });
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        dispatch({
          type: "fail",
          error: { code: "stream_read_failed", message, retryable: true },
        });
        return;
      } finally {
        if (queueRef.current.length > 0) flushQueue();
      }
    },
    [enqueueEvent, flushQueue],
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current);
    };
  }, []);

  return { state, start, reset, getDroppedFile };
}

function stripPdfExt(filename: string): string {
  return filename.replace(/\.pdf$/i, "");
}

function buildRequest(opts: StartOptions, signal: AbortSignal): RequestInit {
  if (opts.caseId) {
    return {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId: opts.caseId }),
    };
  }
  if (opts.files && opts.files.length > 0) {
    const fd = new FormData();
    for (const f of opts.files) fd.append("files", f, f.name);
    return { method: "POST", signal, body: fd };
  }
  throw new Error("useExtractionStream.start requires caseId or files");
}

interface DrainResult {
  payloads: string[];
  remainder: string;
}

/** Split buffer on the SSE frame boundary (\n\n). Each frame may contain
 * multiple `data: ...` lines (per the spec, joined by \n). The route handler
 * always emits exactly one `data: ` line per frame, but be defensive. */
function drainFrames(buffer: string): DrainResult {
  const out: string[] = [];
  let rest = buffer;
  while (true) {
    const idx = rest.indexOf("\n\n");
    if (idx === -1) break;
    const raw = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const dataLines = raw
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    out.push(dataLines.join("\n"));
  }
  return { payloads: out, remainder: rest };
}

function safeParseFrame(raw: string): SseFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
  const f = parsed as { type: string };

  // Re-validate the embedded event so a malformed frame can't poison state.
  if (f.type === "event") {
    const candidate = parsed as { docId?: unknown; event?: unknown };
    const eventResult = TimelineEventSchema.safeParse(candidate.event);
    if (!eventResult.success || typeof candidate.docId !== "string") return null;
    return { type: "event", docId: candidate.docId, event: eventResult.data };
  }

  return parsed as SseFrame;
}

async function readErrorEnvelope(response: Response): Promise<ExtractionError> {
  try {
    const body = await response.json();
    const e = body?.error;
    if (e && typeof e.code === "string" && typeof e.message === "string") {
      return {
        code: e.code,
        message: e.message,
        retryable: Boolean(e.retryable),
      };
    }
  } catch {
    /* ignore — fall through */
  }
  return {
    code: "upstream_unavailable",
    message: `request failed with status ${response.status}`,
    retryable: response.status >= 500,
  };
}
