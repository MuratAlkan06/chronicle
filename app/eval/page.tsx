"use client";

/**
 * /eval — methodology page (BUILD.md H8).
 *
 * Two tabs: Cases 1+2 cached (precomputed reports) and Case 3 live (held-out
 * SSE evaluation). The live tab OPENS on the cached fallback and never auto-runs:
 * a real held-out SSE extraction spends the FINAL remaining scored Case 3
 * measurement event (docs/EVAL.md §6), so it fires only behind an explicit
 * two-step confirm gate (see lib/eval-gate.ts). Pre-run guards still degrade
 * gracefully (gt_not_present, gt_hash_mismatch, prompt_dirty, all_docs_failed).
 *
 * Cmd+Shift+L reloads the cached fallback (data/case3_eval_fallback.json, served
 * via GET /api/eval/fallback — repo-root data/ is not statically served by Next),
 * the backup the demo presenter returns to if a live run is sick.
 */

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Loader2,
} from "lucide-react";
import type { EventType } from "@/lib/schema";
import {
  nextGatePhase,
  shouldStartRun,
  canConfirm,
  ARM_GUARD_MS,
  type GatePhase,
} from "@/lib/eval-gate";
import { DisclaimerFooter } from "@/components/disclaimer-footer";

type CaseId = "case1" | "case2" | "case3";
type Tab = "cached" | "live";

interface TierStats {
  tier: "strict" | "loose";
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  n_gt: number;
}

interface BreakdownRow {
  strict: TierStats;
  loose: TierStats;
  n_gt: number;
}

interface CachedEvalResponse {
  caseId: CaseId;
  tiers: { strict: TierStats; loose: TierStats };
  byEventType: Partial<Record<EventType, BreakdownRow>>;
  promptVersion: string;
  promptHash: string;
  generatedAt: string;
}

interface LiveDocProgress {
  docId: string;
  status: "pending" | "complete" | "error";
}

interface LiveEvalState {
  status: "idle" | "running" | "done" | "error" | "fallback";
  docs: LiveDocProgress[];
  strict: TierStats | null;
  loose: TierStats | null;
  byEventType: Partial<Record<EventType, BreakdownRow>>;
  errorCode: string | null;
  errorMessage: string | null;
  promptVersion: string | null;
  promptHash: string | null;
}

const initialLive: LiveEvalState = {
  status: "idle",
  docs: [],
  strict: null,
  loose: null,
  byEventType: {},
  errorCode: null,
  errorMessage: null,
  promptVersion: null,
  promptHash: null,
};

export default function EvalPage() {
  const [tab, setTab] = useState<Tab>("live");

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-base">
      <header className="border-b border-line bg-base">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors duration-150 hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
              Back
            </Link>
            <span className="font-serif text-[20px] leading-none text-ink">
              Chronicle
            </span>
          </div>
          <div className="flex items-center gap-5">
            <p className="hidden font-mono text-[11px] uppercase tracking-[0.18em] text-ink-subtle md:block">
              Evaluation
            </p>
            <Link
              href="/app"
              className="chronicle-cta-ink inline-flex items-center justify-center rounded-md bg-ink px-3.5 py-1.5 text-[13px] font-medium text-base hover:bg-ink/90"
            >
              Open app
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        <section>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-subtle">
            Methodology
          </p>
          <h1 className="mt-3 text-[clamp(36px,5vw,56px)] font-semibold leading-[1.04] tracking-[-0.03em] text-ink">
            How we know it works.
          </h1>
          <p className="mt-5 max-w-[58ch] text-[16px] leading-relaxed text-ink-muted">
            Chronicle was evaluated on three patient cases. Cases 1+2 were used
            during prompt iteration; Case 3 was held out — never used in prompt
            iteration, its ground truth labeled and hash-locked before the model
            was ever run against it (first recorded run 2026-05-10).
          </p>
        </section>

        <nav className="mt-12 flex items-center gap-1 border-b border-line">
          <TabButton
            active={tab === "live"}
            onClick={() => setTab("live")}
            label="Case 3 — live (held-out)"
            sub="Run on demand"
          />
          <TabButton
            active={tab === "cached"}
            onClick={() => setTab("cached")}
            label="Cases 1 + 2 — cached"
            sub="Iterated reports"
          />
        </nav>

        <div className="mt-10">
          {tab === "live" ? <LivePanel /> : <CachedPanel />}
        </div>
      </main>

      <DisclaimerFooter showEvalLink={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab buttons
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative -mb-px border-b-2 px-5 py-3 text-left transition-colors duration-150 ${
        active ? "border-ink" : "border-transparent hover:border-line"
      }`}
    >
      <p
        className={`text-[13px] font-medium ${active ? "text-ink" : "text-ink-muted"}`}
      >
        {label}
      </p>
      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
        {sub}
      </p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Cached panel — Cases 1 + 2
// ---------------------------------------------------------------------------

function CachedPanel() {
  const [caseId, setCaseId] = useState<CaseId>("case1");
  const [data, setData] = useState<CachedEvalResponse | null>(null);
  // Initial "loading" because the fetch effect runs on mount. When the case
  // toggle changes, the block below resets these back to loading during render
  // (adjust-state-on-prop-change) rather than via a synchronous setState in the
  // effect.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prevCaseId, setPrevCaseId] = useState(caseId);
  if (prevCaseId !== caseId) {
    setPrevCaseId(caseId);
    setLoading(true);
    setError(null);
    setData(null);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/eval?case=${caseId}&mode=cached`)
      .then(async (r) => {
        if (!r.ok) {
          const env = await r.json().catch(() => null);
          throw new Error(env?.error?.message ?? `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((json: CachedEvalResponse) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  return (
    <div>
      <div className="flex items-center gap-2">
        {(["case1", "case2"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setCaseId(id)}
            className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors duration-150 ${
              caseId === id
                ? "bg-ink text-base"
                : "border border-line bg-surface text-ink-muted hover:border-ink-subtle"
            }`}
          >
            {id === "case1" ? "Sarah Chen" : "Maria Rodriguez"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mt-10 flex items-center gap-2 text-[13px] text-ink-subtle">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading report…
        </div>
      ) : error ? (
        <ErrorBlock message={error} />
      ) : data ? (
        <Report
          tiers={data.tiers}
          byEventType={data.byEventType}
          promptVersion={data.promptVersion}
          promptHash={data.promptHash}
          generatedAt={data.generatedAt}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live panel — Case 3 SSE
// ---------------------------------------------------------------------------

function LivePanel() {
  const [state, setState] = useState<LiveEvalState>(initialLive);
  const [gatePhase, setGatePhase] = useState<GatePhase>("idle");
  // Timestamp (ms) the gate was armed, or null when idle. Feeds the pure arming
  // guard (canConfirm) so a held/double Enter can't arm AND fire in one motion.
  const [armedAt, setArmedAt] = useState<number | null>(null);
  // Flips true once the arming-guard window elapses; keeps Confirm disabled til then.
  const [guardCleared, setGuardCleared] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const armButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const running = state.status === "running";

  const start = useCallback(() => {
    abortRef.current?.abort();
    setState({ ...initialLive, status: "running" });
    const controller = new AbortController();
    abortRef.current = controller;

    void fetch("/api/eval?case=case3&mode=live", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok || !r.body) {
          const env = await r.json().catch(() => null);
          throw new Error(
            env?.error?.message ?? `HTTP ${r.status}`,
          );
        }
        return consumeSse(r.body, (frame) => {
          setState((prev) => applyFrame(prev, frame));
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          status: "error",
          errorCode: "network",
          errorMessage: err instanceof Error ? err.message : String(err),
        }));
      });
  }, []);

  const loadFallback = useCallback(() => {
    abortRef.current?.abort();
    fetch("/api/eval/fallback")
      .then((r) => r.json())
      .then((json) => {
        if (json?._placeholder) {
          setState({
            ...initialLive,
            status: "fallback",
            errorCode: "fallback_placeholder",
            errorMessage:
              "Fallback file is still a placeholder — real Case 3 metrics land at H11.",
          });
          return;
        }
        setState({
          status: "fallback",
          docs: [],
          strict: json.tiers?.strict ?? null,
          loose: json.tiers?.loose ?? null,
          byEventType: json.byEventType ?? {},
          errorCode: null,
          errorMessage: null,
          promptVersion: json.promptVersion ?? null,
          promptHash: json.promptHash ?? null,
        });
      })
      .catch(() => {
        setState((prev) => ({
          ...prev,
          status: "error",
          errorCode: "fallback_missing",
          errorMessage: "Couldn't load case3_eval_fallback.json.",
        }));
      });
  }, []);

  // Open on the cached fallback (never auto-run a scored live measurement) and
  // keep Cmd+Shift+L as a "reload the cached fallback" escape. The live held-out
  // run fires only through the explicit two-step gate below — not on mount.
  useEffect(() => {
    loadFallback();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        loadFallback();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      abortRef.current?.abort();
    };
  }, [loadFallback]);

  const handleArm = useCallback(() => {
    setGatePhase(nextGatePhase("arm"));
    setGuardCleared(false);
    setArmedAt(Date.now());
  }, []);

  const handleCancel = useCallback(() => {
    setGatePhase(nextGatePhase("cancel"));
    setArmedAt(null);
    setGuardCleared(false);
  }, []);

  // Two-step confirm with two independent guards: the arming guard (canConfirm)
  // makes Confirm inert for ARM_GUARD_MS after arming so a key-repeat/double
  // Enter physically cannot fire it; shouldStartRun keeps the run armed-only and
  // single-flight. The final scored Case 3 measurement can never fire on mount,
  // from a double click, or from a held Enter carried onto the reused node.
  const handleConfirm = useCallback(() => {
    if (armedAt === null || !canConfirm(armedAt, Date.now())) return;
    if (shouldStartRun(gatePhase, running)) start();
    setGatePhase(nextGatePhase("confirm"));
    setArmedAt(null);
    setGuardCleared(false);
  }, [gatePhase, running, start, armedAt]);

  // Arming-guard timer: hold Confirm disabled for ARM_GUARD_MS after each arm,
  // then enable it. Re-scheduled on every fresh arm (armedAt changes).
  useEffect(() => {
    if (armedAt === null) return;
    const t = setTimeout(() => setGuardCleared(true), ARM_GUARD_MS);
    return () => clearTimeout(t);
  }, [armedAt]);

  // Escape cancels an armed gate (armed → idle); listener is bound only while
  // armed, so it has no effect in any other phase.
  useEffect(() => {
    if (gatePhase !== "armed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gatePhase, handleCancel]);

  // Focus management (the safety half of fix #1): after arming, focus must NOT
  // rest on Confirm — React reuses the arm button's node for Confirm, carrying
  // focus. Move focus to the safe Cancel default on arm; return it to the arm
  // button on cancel/Escape. Never fires on the initial idle mount.
  const prevPhaseRef = useRef<GatePhase>(gatePhase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = gatePhase;
    if (gatePhase === "armed" && prev !== "armed") {
      cancelButtonRef.current?.focus();
    } else if (gatePhase === "idle" && prev === "armed") {
      armButtonRef.current?.focus();
    }
  }, [gatePhase]);

  // After a run ends the gate re-appears at idle; return focus to the arm button
  // so keyboard focus isn't stranded on <body>. Skips the first mount.
  const prevRunningRef = useRef(running);
  useEffect(() => {
    const prev = prevRunningRef.current;
    prevRunningRef.current = running;
    if (prev && !running) armButtonRef.current?.focus();
  }, [running]);

  return (
    <div>
      {/* Live-run gate — the ONLY trigger for a scored held-out run. Hidden
          while a run streams so it cannot be re-fired (no double runs). */}
      {!running ? (
        <LiveRunGate
          phase={gatePhase}
          confirmDisabled={!guardCleared}
          armButtonRef={armButtonRef}
          cancelButtonRef={cancelButtonRef}
          onArm={handleArm}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
        />
      ) : null}

      {/* Streaming doc badges */}
      {state.docs.length > 0 ? (
        <div className="mb-8 flex flex-wrap items-center gap-2">
          {state.docs.map((d) => (
            <span
              key={d.docId}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] tracking-wider ${
                d.status === "complete"
                  ? "border-accent-teal/40 bg-accent-teal/[0.04] text-ink"
                  : d.status === "error"
                    ? "border-sev-concerning/40 bg-sev-concerning/[0.04] text-sev-concerning"
                    : "border-line bg-surface text-ink-muted"
              }`}
            >
              {d.status === "complete" ? (
                <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
              ) : d.status === "error" ? (
                <AlertTriangle className="h-3 w-3" strokeWidth={2} />
              ) : (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              {d.docId}
            </span>
          ))}
        </div>
      ) : null}

      {state.status === "running" && state.docs.length === 0 ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-subtle">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Starting evaluation…
        </div>
      ) : null}

      {state.status === "error" || state.errorCode ? (
        <LiveErrorBlock
          code={state.errorCode}
          message={state.errorMessage}
          onFallback={loadFallback}
        />
      ) : null}

      {state.strict && state.loose ? (
        <Report
          tiers={{ strict: state.strict, loose: state.loose }}
          byEventType={state.byEventType}
          promptVersion={state.promptVersion}
          promptHash={state.promptHash}
          generatedAt={null}
          tag={state.status === "fallback" ? "Cached fallback" : "Live held-out"}
        />
      ) : null}

      <p className="mt-12 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
        Press ⌘+⇧+L to reload the cached fallback
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live-run gate — two-step inline confirm. The live held-out run spends the
// FINAL remaining scored Case 3 measurement event (docs/EVAL.md §6), so it is
// never auto-run and never one click. No native window.confirm — inline only.
// ---------------------------------------------------------------------------

function LiveRunGate({
  phase,
  confirmDisabled,
  armButtonRef,
  cancelButtonRef,
  onArm,
  onCancel,
  onConfirm,
}: {
  phase: GatePhase;
  confirmDisabled: boolean;
  armButtonRef: RefObject<HTMLButtonElement | null>;
  cancelButtonRef: RefObject<HTMLButtonElement | null>;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (phase === "armed") {
    return (
      <div className="mb-10 rounded-md border border-sev-concerning/40 bg-sev-concerning/[0.04] p-6">
        {/* Eyebrow uses the darker severity token (sev-urgent #991B1B) so the
            label clears 4.5:1 on the tinted card — the concerning red (#DC2626)
            only reaches ~4.36:1 here. Card border/tint stay sev-concerning. */}
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sev-urgent">
          Confirm live run
        </p>
        <h3 className="mt-3 text-[16px] font-semibold tracking-[-0.01em] text-ink">
          This spends the final scored Case 3 measurement.
        </h3>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink-muted">
          The live held-out extraction consumes the last remaining scored Case 3
          measurement event — the final confirmatory budget on the held-out case
          (docs/EVAL.md §6). Only confirm when you mean to record it.
        </p>
        {/* Wide gap so a fingertip can't bridge Confirm and Cancel. Confirm is
            disabled through the arming-guard window (fix #1, no layout shift);
            Cancel is padded to a ≥24px (≈44px effective) touch target. */}
        <div className="mt-5 flex items-center gap-6">
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="chronicle-cta-ink rounded-md bg-ink px-4 py-2 text-[12px] font-medium text-base transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50"
          >
            Confirm — run live extraction
          </button>
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-[12px] font-medium text-ink-muted transition-colors duration-150 hover:bg-line/50 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mb-10 rounded-md border border-line bg-base p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
        Held-out · Case 3
      </p>
      <h3 className="mt-3 text-[16px] font-semibold tracking-[-0.01em] text-ink">
        Live extraction is off by default.
      </h3>
      <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink-muted">
        The cached fallback from the last recorded run of the active model is
        shown below. Running the live held-out extraction spends the final scored
        Case 3 measurement event (docs/EVAL.md §6), so it is gated behind an
        explicit confirm.
      </p>
      <div className="mt-5">
        <button
          ref={armButtonRef}
          type="button"
          onClick={onArm}
          className="chronicle-cta-ink rounded-md bg-ink px-4 py-2 text-[12px] font-medium text-base transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          Run live extraction…
        </button>
      </div>
    </div>
  );
}

function applyFrame(state: LiveEvalState, frame: SseFrameLite): LiveEvalState {
  switch (frame.type) {
    case "started":
      return state;
    case "doc_started": {
      if (state.docs.some((d) => d.docId === frame.docId)) return state;
      return {
        ...state,
        docs: [
          ...state.docs,
          { docId: frame.docId, status: "pending" as const },
        ],
      };
    }
    case "doc_complete":
      return {
        ...state,
        docs: state.docs.map((d) =>
          d.docId === frame.docId ? { ...d, status: "complete" as const } : d,
        ),
      };
    case "doc_error":
      return {
        ...state,
        docs: state.docs.map((d) =>
          d.docId === frame.docId ? { ...d, status: "error" as const } : d,
        ),
      };
    case "metric":
      if (frame.tier === "strict") {
        return { ...state, strict: frame.value as TierStats };
      }
      return { ...state, loose: frame.value as TierStats };
    case "breakdown":
      return {
        ...state,
        byEventType:
          (frame.value as { byEventType?: typeof state.byEventType })
            .byEventType ?? state.byEventType,
      };
    case "error":
      return {
        ...state,
        status: "error",
        errorCode: frame.code,
        errorMessage: frame.message,
      };
    case "done":
      return { ...state, status: "done" };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Report — strict + loose cards + per-event-type table + methodology details
// ---------------------------------------------------------------------------

interface ReportProps {
  tiers: { strict: TierStats; loose: TierStats };
  byEventType: Partial<Record<EventType, BreakdownRow>>;
  promptVersion: string | null;
  promptHash: string | null;
  generatedAt: string | null;
  tag?: string;
}

function Report({
  tiers,
  byEventType,
  promptVersion,
  promptHash,
  generatedAt,
  tag,
}: ReportProps) {
  return (
    <div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <TierCard label="Strict" stats={tiers.strict} />
        <TierCard label="Loose · ±3 days" stats={tiers.loose} />
      </div>

      <h3 className="mt-12 text-[16px] font-semibold tracking-[-0.01em] text-ink">
        Per event type
      </h3>
      <div className="mt-4 overflow-hidden rounded-md border border-line">
        <table className="w-full text-[13px]">
          <thead className="bg-base">
            <tr>
              <th className="border-b border-line px-4 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
                Type
              </th>
              <th className="border-b border-line px-4 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
                n_gt
              </th>
              <th className="border-b border-line px-4 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
                Strict P / R / F1
              </th>
              <th className="border-b border-line px-4 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-ink-subtle">
                Loose P / R / F1
              </th>
            </tr>
          </thead>
          <tbody>
            {EVENT_TYPE_ORDER.map((t) => {
              const row = byEventType[t];
              const empty = !row || row.n_gt === 0;
              return (
                <tr key={t} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5 text-ink">{t}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-ink-muted">
                    {row?.n_gt ?? 0}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-ink-muted">
                    {empty
                      ? "—"
                      : tierTriple(row.strict)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-ink-muted">
                    {empty
                      ? "—"
                      : tierTriple(row.loose)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <details className="group mt-12">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-ink">
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          Methodology
        </summary>
        <div className="mt-4 space-y-3 text-[13px] leading-relaxed text-ink-muted">
          <p>
            Strict tier requires the predicted event to match a ground-truth
            event on event_type AND date (within 0 days). Loose tier allows ±3
            days on the date. Greedy 1-1 matching by token overlap on titles
            (≥0.5).
          </p>
          <p>
            Ground-truth labels for Cases 1 + 2 were derived from their
            fixtures and locked before prompt iteration. Case 3 was never used
            in prompt iteration; its ground truth was labeled and hash-locked at
            <code className="mx-1 rounded-sm bg-base px-1 py-[1px] font-mono text-[11px]">
              held_out/case3/.gt_hash.lock
            </code>
            before the model was ever run against it — the eval route refuses
            to run if the file has been modified.
          </p>
          {promptVersion ? (
            <p>
              Active prompt:{" "}
              <code className="rounded-sm bg-base px-1 py-[1px] font-mono text-[11px]">
                {promptVersion}
              </code>
              {promptHash ? (
                <>
                  {" "}@ <code className="rounded-sm bg-base px-1 py-[1px] font-mono text-[11px]">{promptHash}</code>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </details>

      <p className="mt-10 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
        {tag ?? "Cached"}
        {generatedAt
          ? ` · generated ${new Date(generatedAt).toLocaleString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}`
          : ""}
      </p>
    </div>
  );
}

const EVENT_TYPE_ORDER: EventType[] = [
  "lab",
  "imaging",
  "visit",
  "diagnosis",
  "medication",
  "procedure",
  "referral",
];

function tierTriple(t: TierStats): string {
  return `${pct(t.precision)} · ${pct(t.recall)} · ${pct(t.f1)}`;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function TierCard({ label, stats }: { label: string; stats: TierStats }) {
  return (
    <div className="rounded-md border border-line bg-base p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-subtle">
        {label}
      </p>
      <div className="mt-5 grid grid-cols-3 gap-4">
        <Metric label="Precision" value={pct(stats.precision)} />
        <Metric label="Recall" value={pct(stats.recall)} />
        <Metric label="F1" value={pct(stats.f1)} />
      </div>
      <div className="mt-6 flex items-center gap-4 border-t border-line pt-4 font-mono text-[11px] text-ink-subtle">
        <span>tp · {stats.tp}</span>
        <span>fp · {stats.fp}</span>
        <span>fn · {stats.fn}</span>
        <span>n_gt · {stats.n_gt}</span>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink">
        {value}
      </p>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-subtle">
        {label}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="mt-10 flex items-start gap-3 rounded-md border border-sev-concerning/40 bg-sev-concerning/[0.04] px-4 py-3 text-[13px]">
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-sev-concerning"
        strokeWidth={1.8}
      />
      <p className="text-ink-muted">{message}</p>
    </div>
  );
}

function LiveErrorBlock({
  code,
  message,
  onFallback,
}: {
  code: string | null;
  message: string | null;
  onFallback: () => void;
}) {
  const meta = liveErrorCopy(code);
  return (
    <div className="mt-2 rounded-md border border-line bg-base p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
        {meta.tag}
      </p>
      <h3 className="mt-3 text-[20px] font-semibold leading-tight tracking-[-0.01em] text-ink">
        {meta.headline}
      </h3>
      <p className="mt-2 max-w-[60ch] text-[13px] leading-relaxed text-ink-muted">
        {meta.body}
      </p>
      {message ? (
        <p className="mt-3 font-mono text-[11px] text-ink-subtle">{message}</p>
      ) : null}
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={onFallback}
          className="text-[12px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          Load cached fallback (⌘+⇧+L)
        </button>
      </div>
      {/* Live re-runs go back through the two-step gate above — never one click. */}
      <p className="mt-4 text-[12px] leading-relaxed text-ink-subtle">
        To run the live extraction again, use the confirm gate above.
      </p>
    </div>
  );
}

function liveErrorCopy(code: string | null): {
  tag: string;
  headline: string;
  body: string;
} {
  switch (code) {
    case "gt_not_present":
      return {
        tag: "Held-out data unavailable",
        headline: "Case 3 held-out data isn't available.",
        body: "The live evaluation graceful-degrades with this notice when Case 3's held-out ground truth or PDFs aren't present at run time. Case 3 is otherwise labeled and hash-locked — load the cached fallback below to see the recorded run.",
      };
    case "gt_hash_mismatch":
      return {
        tag: "Integrity check failed",
        headline: "Ground truth has been modified.",
        body: "The evaluation refuses to run because held_out/case3/ground_truth.json no longer matches its hash lock. This is a held-out hygiene safeguard.",
      };
    case "prompt_dirty":
      return {
        tag: "Prompt dirty",
        headline: "Uncommitted prompt changes detected.",
        body: "The eval requires a clean prompt git state for reproducibility. Commit prompt changes and retry.",
      };
    case "fallback_placeholder":
      return {
        tag: "Fallback placeholder",
        headline: "Fallback file is empty.",
        body: "data/case3_eval_fallback.json is currently a placeholder — real Case 3 metrics land at H11 after the live run is captured.",
      };
    case "all_docs_failed":
      return {
        tag: "No successful extractions",
        headline: "Every document failed to extract.",
        body: "All Case 3 documents errored during extraction — typically an API auth or transport failure — so there's nothing to score. This run is not a measurement and was not saved. Check the server logs / API key and retry, or load the cached fallback below.",
      };
    default:
      return {
        tag: "Eval error",
        headline: "Couldn't run live evaluation.",
        body: "Try again, or load the cached fallback below if the live run is sick.",
      };
  }
}

// ---------------------------------------------------------------------------
// SSE consumer (simple — no leaky bucket needed here, frames are sparse)
// ---------------------------------------------------------------------------

type SseFrameLite =
  | { type: "started" }
  | { type: "doc_started"; docId: string; filename?: string; totalDocs?: number }
  | { type: "doc_complete"; docId: string }
  | { type: "doc_error"; docId: string; message: string }
  | { type: "metric"; tier: "strict" | "loose"; value: TierStats }
  | { type: "breakdown"; value: { byEventType: Partial<Record<EventType, BreakdownRow>> } }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "done" };

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: SseFrameLite) => void,
): Promise<void> {
  const reader = body.getReader();
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
        onFrame(JSON.parse(line) as SseFrameLite);
      } catch {
        /* ignore malformed */
      }
    }
  }
}
