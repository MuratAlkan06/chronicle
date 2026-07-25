"use client";

/**
 * SidePanel — slide-over showing event metadata + the source PDF with the
 * verbatim snippet highlighted (BUILD.md H6 polish).
 *
 * PDF source resolution:
 *  - cached preset: GET /api/cases/<caseId>/docs/<docId>  → URL
 *  - ad-hoc drop: in-memory File from useExtractionStream → Blob
 *
 * Loaded via next/dynamic with ssr:false so pdfjs-dist's window references
 * never run server-side.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { TimelineEvent } from "@/lib/schema";

const PdfViewer = dynamic(() => import("./pdf-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center text-sm text-ink-subtle">
      Initializing viewer…
    </div>
  ),
});

interface SidePanelProps {
  event: TimelineEvent | null;
  caseId: "case1" | "case2" | "case3" | null;
  /** Lookup for ad-hoc dropped File by docId. Returns null for preset cases. */
  getDroppedFile: (docId: string) => File | null;
  /** Full event pool — used as the candidate set for /api/related. */
  allEvents: TimelineEvent[];
  /** Switch the panel to a different event (related-card click). */
  onSelect: (event: TimelineEvent) => void;
  onClose: () => void;
}

export function SidePanel({
  event,
  caseId,
  getDroppedFile,
  allEvents,
  onSelect,
  onClose,
}: SidePanelProps) {
  const open = event !== null;
  const docId = event?.source.document_id ?? null;

  // Resolve source: caseId path OR Blob (only when actively viewing).
  const droppedFile = useMemo(
    () => (docId ? getDroppedFile(docId) : null),
    [docId, getDroppedFile],
  );
  const source: string | Blob | null = useMemo(() => {
    if (!docId) return null;
    if (caseId) return `/api/cases/${caseId}/docs/${docId}`;
    if (droppedFile) return droppedFile;
    return null;
  }, [caseId, docId, droppedFile]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full bg-base p-0 sm:max-w-[640px]"
      >
        {event ? (
          <PanelBody
            event={event}
            source={source}
            allEvents={allEvents}
            onSelect={onSelect}
          />
        ) : (
          <SheetHeader>
            <SheetTitle>—</SheetTitle>
            <SheetDescription>No event selected.</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PanelBody({
  event,
  source,
  allEvents,
  onSelect,
}: {
  event: TimelineEvent;
  source: string | Blob | null;
  allEvents: TimelineEvent[];
  onSelect: (event: TimelineEvent) => void;
}) {
  const [mounted, setMounted] = useState(false);
  // Defer rendering the pdf viewer one frame so the sheet's slide-in
  // animation has a chance to complete before we hammer pdfjs.
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, [event.id]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-line bg-surface px-6 py-5">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={event.severity} />
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-subtle">
            {event.event_type}
          </span>
        </div>
        <SheetHeader className="p-0">
          <SheetTitle className="mt-3 text-[18px] font-semibold leading-tight text-ink">
            {event.title}
          </SheetTitle>
          <SheetDescription className="mt-1 font-mono text-[11px] tracking-wider text-ink-subtle">
            {formatDate(event.date, event.date_confidence)}
            {event.provider ? ` · ${event.provider}` : null}
          </SheetDescription>
        </SheetHeader>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
          {event.summary}
        </p>
        <p className="mt-3 font-mono text-[11px] tracking-wider text-ink-subtle">
          source · {event.source.document_id} · p.{event.source.page}
        </p>
        {/* Keyed by event.id so switching events remounts the section — a clean
            reset of its stream state, and its unmount cleanup aborts any
            in-flight request (replaces the former reset effect). */}
        <ExplainerSection key={event.id} event={event} />
      </div>

      <div className="flex-1 overflow-auto p-4">
        {source && mounted ? (
          <PdfViewer
            source={source}
            page={event.source.page}
            snippet={event.source.snippet}
          />
        ) : (
          <div className="flex h-64 items-center justify-center rounded-md border border-line bg-surface text-sm text-ink-subtle">
            {source ? "Loading viewer…" : "Source PDF unavailable."}
          </div>
        )}
        {/* Keyed by event.id (same reset-on-event-change rationale as above). */}
        <RelatedSection
          key={event.id}
          event={event}
          allEvents={allEvents}
          onSelect={onSelect}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExplainerSection — Gemini Flash streaming explainer (H7)
// ---------------------------------------------------------------------------

function ExplainerSection({ event }: { event: TimelineEvent }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(() => {
    abortRef.current?.abort();
    setText("");
    setError(null);
    setStatus("streaming");
    const controller = new AbortController();
    abortRef.current = controller;

    void fetch("/api/explain", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: event.id, event }),
    })
      .then(async (r) => {
        if (!r.ok || !r.body) {
          const env = await r.json().catch(() => null);
          throw new Error(env?.error?.message ?? `HTTP ${r.status}`);
        }
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          while (true) {
            const idx = buffer.indexOf("\n\n");
            if (idx === -1) break;
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const line = raw
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            if (!line) continue;
            try {
              const frame = JSON.parse(line) as
                | { type: "token"; text: string }
                | { type: "done" }
                | { type: "error"; message: string };
              if (frame.type === "token") {
                setText((prev) => prev + frame.text);
              } else if (frame.type === "error") {
                setError(frame.message);
              }
            } catch {
              /* ignore */
            }
          }
        }
        setStatus("done");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [event]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <div className="mt-4">
      {status === "idle" && !text ? (
        <button
          type="button"
          onClick={start}
          className="inline-flex items-center gap-2 rounded-md border border-line bg-base px-3 py-1.5 text-[12px] font-medium text-ink transition-colors duration-150 hover:border-ink-subtle"
        >
          <Sparkles className="h-3.5 w-3.5 text-accent-teal" strokeWidth={1.8} />
          Explain in plain language
        </button>
      ) : null}

      {(status !== "idle" || text) && (
        <div className="rounded-md border border-line bg-base p-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
              Patient view
              {status === "streaming" ? " · generating" : null}
            </p>
            {status === "streaming" ? (
              <Loader2
                className="h-3 w-3 animate-spin text-ink-subtle"
                strokeWidth={2}
              />
            ) : null}
          </div>
          {text ? (
            <p className="mt-2 text-[13px] leading-relaxed text-ink">{text}</p>
          ) : status === "streaming" ? (
            <p className="mt-2 text-[13px] text-ink-subtle">…</p>
          ) : null}
          {error ? (
            <p className="mt-2 text-[12px] text-sev-concerning">{error}</p>
          ) : null}
          {status === "done" || status === "error" ? (
            <button
              type="button"
              onClick={start}
              className="mt-3 text-[11px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
            >
              Re-explain
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RelatedSection — Voyage embeddings cosine top-3 (H10)
// ---------------------------------------------------------------------------

interface RelatedHit {
  eventId: string;
  score: number;
}

function RelatedSection({
  event,
  allEvents,
  onSelect,
}: {
  event: TimelineEvent;
  allEvents: TimelineEvent[];
  onSelect: (event: TimelineEvent) => void;
}) {
  const [hits, setHits] = useState<RelatedHit[]>([]);
  // Starts in "loading": the fetch effect runs immediately on mount, and
  // switching events remounts this section via its key (see PanelBody), so a
  // fresh mount always begins in the loading state.
  const [status, setStatus] = useState<
    "idle" | "loading" | "done" | "empty" | "error"
  >("loading");

  // The fetch below also re-runs *without* a remount: `allEvents` is the live
  // candidate pool, whose identity changes on every batch the extraction stream
  // appends. Each re-run must return to the loading state, or hits computed
  // from a partial pool stay on screen as settled results and then silently
  // reorder under the cursor — these are click targets. Done as an
  // adjust-state-during-render (same pattern as pdf-viewer.tsx) rather than a
  // synchronous setState inside the effect.
  const [fetchKey, setFetchKey] = useState({ eventId: event.id, allEvents });
  if (fetchKey.eventId !== event.id || fetchKey.allEvents !== allEvents) {
    setFetchKey({ eventId: event.id, allEvents });
    setStatus("loading");
    setHits([]);
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/related", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: event.id, candidates: allEvents }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ related: RelatedHit[] }>;
      })
      .then((data) => {
        if (!data.related || data.related.length === 0) {
          setStatus("empty");
          return;
        }
        setHits(data.related);
        setStatus("done");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error("[related] error", err);
        setStatus("error");
      });
    return () => controller.abort();
  }, [event.id, allEvents]);

  if (status === "loading") {
    return (
      <div className="mt-6 flex items-center gap-2 text-[12px] text-ink-subtle">
        <Loader2 className="h-3 w-3 animate-spin" /> Finding related events…
      </div>
    );
  }
  if (status === "error" || status === "empty") return null;

  const eventsById = new Map(allEvents.map((e) => [e.id, e]));

  return (
    <div className="mt-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
        Related events
      </p>
      <ul className="mt-3 space-y-2">
        {hits.map((h) => {
          const target = eventsById.get(h.eventId);
          if (!target) return null;
          return (
            <li key={h.eventId}>
              <button
                type="button"
                onClick={() => onSelect(target)}
                className="group/related flex w-full items-start gap-3 rounded-md border border-line bg-surface px-3 py-2.5 text-left transition-all duration-150 hover:-translate-y-px hover:border-ink-subtle hover:shadow-[0_2px_8px_rgba(15,23,42,0.04)]"
              >
                <span className="font-mono text-[10px] tracking-wider text-accent-teal">
                  {(h.score * 100).toFixed(0)}%
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-tight text-ink">
                    {target.title}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] tracking-wider text-ink-subtle">
                    {formatDate(target.date, target.date_confidence)} ·{" "}
                    {target.event_type}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: TimelineEvent["severity"];
}) {
  const meta = SEVERITY_META[severity];
  return (
    <span
      className="rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
      style={{ color: meta.color, backgroundColor: meta.bg }}
    >
      Severity: {meta.label}
    </span>
  );
}

const SEVERITY_META: Record<
  TimelineEvent["severity"],
  { color: string; bg: string; label: string }
> = {
  info: {
    color: "var(--color-sev-info)",
    bg: "rgba(107,114,128,0.10)",
    label: "Info",
  },
  monitor: {
    color: "var(--color-sev-monitor)",
    bg: "rgba(217,119,6,0.10)",
    label: "Monitor",
  },
  concerning: {
    color: "var(--color-sev-concerning)",
    bg: "rgba(220,38,38,0.10)",
    label: "Concerning",
  },
  urgent: {
    color: "var(--color-sev-urgent)",
    bg: "rgba(153,27,27,0.10)",
    label: "Urgent",
  },
};

function formatDate(
  iso: string,
  conf: TimelineEvent["date_confidence"],
): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const long = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  if (conf === "exact") return long;
  const short = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
  });
  return conf === "approximate" ? `~${short}` : `${short} (inferred)`;
}
