"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import Link from "next/link";
import { AlertTriangle, Loader2, Upload } from "lucide-react";
import type { TimelineEvent } from "@/lib/schema";
import { DisclaimerFooter } from "@/components/disclaimer-footer";
import { SplashDisclaimer } from "@/components/splash-disclaimer";
import { Timeline } from "@/components/timeline";
import { SidePanel } from "@/components/side-panel";
import {
  useExtractionStream,
  type DocProgress,
  type ExtractionError,
} from "@/lib/use-extraction-stream";

type CaseId = "case1" | "case2" | "case3";

const PRESETS: Array<{ id: CaseId; label: string; sublabel: string }> = [
  { id: "case1", label: "Sarah Chen, 47F", sublabel: "Type 2 Diabetes · 18 mo" },
  {
    id: "case2",
    label: "Maria Rodriguez, 52F",
    sublabel: "Mammogram → biopsy · 3 mo",
  },
  {
    id: "case3",
    label: "David Park, 38M",
    sublabel: "Chronic LBP · mock-only",
  },
];

export default function AppPage() {
  const { state, start, reset, getDroppedFile } = useExtractionStream();
  const [activeCase, setActiveCase] = useState<CaseId | null>(null);
  const [droppedNames, setDroppedNames] = useState<string[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);

  const loadPreset = useCallback(
    (id: CaseId) => {
      setActiveCase(id);
      setDroppedNames([]);
      setSelectedEvent(null);
      void start({ caseId: id });
    },
    [start],
  );

  const onDrop = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      setDroppedNames(files.map((f) => f.name));
      setActiveCase(null);
      setSelectedEvent(null);
      void start({ files });
    },
    [start],
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } =
    useDropzone({
      onDrop,
      accept: { "application/pdf": [".pdf"] },
      multiple: true,
      noClick: false,
    });

  useEffect(() => () => reset(), [reset]);

  const isExtracting = state.status === "extracting";
  const completedDocs = state.docs.filter((d) => d.status === "complete").length;
  const erroredDocs = state.docs.filter((d) => d.status === "error");

  return (
    <>
      <SplashDisclaimer />
      <div className="flex min-h-screen flex-1 flex-col bg-base">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
            <Link
              href="/"
              className="font-serif text-[22px] leading-none text-ink"
            >
              Chronicle
            </Link>
            <p className="hidden text-xs leading-snug text-ink-subtle sm:block">
              Not medical advice
            </p>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
          <section>
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink">
              Drop your records.
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Multi-file PDF upload. Each event cites a verbatim quote from the
              source document — click any card to jump to it.
            </p>
          </section>

          <section className="mt-8">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
              Try a sample case
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {PRESETS.map((p) => {
                const active = activeCase === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => loadPreset(p.id)}
                    disabled={isExtracting}
                    className={`group/preset text-left rounded-lg border px-4 py-3 transition-all duration-150 ease-out hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] disabled:cursor-not-allowed disabled:opacity-60 ${
                      active
                        ? "border-accent-teal bg-accent-teal/[0.04]"
                        : "border-line bg-surface hover:border-ink-subtle"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-ink">
                        {p.label}
                      </span>
                      {active ? (
                        <span className="text-[10px] font-medium uppercase tracking-wider text-accent-teal">
                          loaded
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs leading-snug text-ink-muted">
                      {p.sublabel}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-8">
            <div
              {...getRootProps()}
              className={`group flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors duration-150 ${
                isDragReject
                  ? "border-sev-concerning bg-sev-concerning/5"
                  : isDragActive
                    ? "border-accent-teal bg-accent-teal/[0.06]"
                    : "border-line bg-surface hover:border-ink-subtle"
              }`}
            >
              <input {...getInputProps()} />
              <Upload
                className="mb-3 h-6 w-6 text-ink-subtle group-hover:text-ink-muted"
                strokeWidth={1.6}
                aria-hidden
              />
              <p className="text-base font-medium text-ink">
                {isDragReject
                  ? "PDFs only"
                  : isDragActive
                    ? "Drop to extract"
                    : "Drop PDFs here, or click to choose"}
              </p>
              <p className="mt-2 text-xs text-ink-subtle">
                Multiple files supported · in-memory only
              </p>
              {droppedNames.length > 0 ? (
                <ul className="mt-4 max-w-sm space-y-1 text-xs text-ink-muted">
                  {droppedNames.map((n) => (
                    <li key={n} className="truncate">
                      {n}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>

          {state.error ? (
            <ErrorBanner error={state.error} onDismiss={reset} />
          ) : null}

          <ProgressStrip
            isExtracting={isExtracting}
            completedDocs={completedDocs}
            totalDocs={state.totalDocs}
            erroredDocs={erroredDocs}
          />

          <section className="mt-12">
            <header className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-ink">
                Timeline
                {state.events.length > 0 ? (
                  <span className="ml-2 text-xs font-normal text-ink-subtle">
                    {state.events.length} extracted
                  </span>
                ) : null}
              </h2>
              {activeCase ? (
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-subtle">
                  preset · {activeCase}
                </span>
              ) : null}
            </header>

            {state.events.length === 0 ? (
              <p className="mt-6 text-sm leading-relaxed text-ink-subtle">
                {isExtracting
                  ? "Reading documents…"
                  : "No events yet. Drop PDFs above or pick a sample case."}
              </p>
            ) : (
              <div className="mt-8">
                <Timeline
                  events={state.events}
                  selectedId={selectedEvent?.id ?? null}
                  onSelect={setSelectedEvent}
                />
              </div>
            )}
          </section>
        </main>

        <DisclaimerFooter />
      </div>

      <SidePanel
        event={selectedEvent}
        caseId={state.caseId}
        getDroppedFile={getDroppedFile}
        allEvents={state.events}
        onSelect={setSelectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </>
  );
}

function ErrorBanner({
  error,
  onDismiss,
}: {
  error: ExtractionError;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="mt-8 flex items-start gap-3 rounded-md border border-sev-concerning/40 bg-sev-concerning/[0.04] px-4 py-3"
    >
      <AlertTriangle
        className="mt-0.5 h-4 w-4 shrink-0 text-sev-concerning"
        strokeWidth={1.8}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          {humanizeErrorCode(error.code)}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
          {error.message}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs font-medium text-ink-subtle hover:text-ink"
      >
        Dismiss
      </button>
    </div>
  );
}

function ProgressStrip({
  isExtracting,
  completedDocs,
  totalDocs,
  erroredDocs,
}: {
  isExtracting: boolean;
  completedDocs: number;
  totalDocs: number;
  erroredDocs: DocProgress[];
}) {
  if (!isExtracting && erroredDocs.length === 0 && totalDocs === 0) return null;

  return (
    <section className="mt-8 space-y-2">
      {(isExtracting || totalDocs > 0) && (
        <div className="flex items-center gap-2 text-xs text-ink-subtle">
          {isExtracting ? (
            <Loader2
              className="h-3.5 w-3.5 animate-spin text-accent-teal"
              strokeWidth={2}
              aria-hidden
            />
          ) : null}
          <span>
            {totalDocs > 0
              ? `${completedDocs} / ${totalDocs} document${totalDocs === 1 ? "" : "s"} processed`
              : "Starting extraction…"}
          </span>
        </div>
      )}
      {erroredDocs.length > 0 ? (
        <ul className="space-y-1">
          {erroredDocs.map((d) => (
            <li
              key={d.docId}
              className="flex items-start gap-2 rounded-sm border border-sev-concerning/30 bg-sev-concerning/[0.03] px-3 py-2 text-xs text-ink-muted"
            >
              <span className="font-mono text-sev-concerning">✗</span>
              <span className="min-w-0 flex-1">
                <span className="font-mono">{d.filename}</span>
                <span className="text-ink-subtle"> — skipped: {d.error}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function humanizeErrorCode(code: string): string {
  switch (code) {
    case "case_not_extracted":
      return "Case not yet available";
    case "pdf_invalid":
      return "Couldn't read those files";
    case "extraction_failed":
      return "Extraction failed";
    case "upstream_unavailable":
      return "Upstream service unavailable";
    case "rate_limit":
      return "Rate limited — try again shortly";
    case "network":
      return "Network error";
    default:
      return "Something went wrong";
  }
}
