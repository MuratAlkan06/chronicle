"use client";

/**
 * PdfViewer — react-pdf with text-layer + verbatim-snippet highlight overlay.
 *
 * Per BUILD.md H3: when a page renders, collect every text-layer span,
 * run lib/match.ts sliding-window against their joined-and-normalized text,
 * wrap the matched run in a yellow background, scrollIntoView. Fallback if
 * no match: render a yellow banner pinned to the top of the page with the
 * snippet text + a 1-line "could not pinpoint" caption (per H3 spec).
 *
 * The component is loaded via next/dynamic with ssr:false in the consumer
 * (SidePanel) so pdfjs-dist's window references never run server-side.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { matchSnippet } from "@/lib/match";

// pdf.worker.min.mjs is copied into public/ at install time (BUILD.md Block 6).
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
}

interface PdfViewerProps {
  /** The PDF source — either a route URL (cached cases) or a Blob (ad-hoc). */
  source: string | Blob;
  page: number;
  /** Verbatim snippet to highlight in the rendered text layer. */
  snippet: string;
}

export default function PdfViewer({ source, page, snippet }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageLoaded, setPageLoaded] = useState(false);
  const [matchOutcome, setMatchOutcome] = useState<
    "pending" | "matched" | "fallback"
  >("pending");

  // Convert Blob → object URL so we hand react-pdf a stable string regardless
  // of the source shape; revoke on cleanup. Strings (cases route) pass through.
  const [file, setFile] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (typeof source === "string") {
      setFile(source);
      return;
    }
    const url = URL.createObjectURL(source);
    setFile(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);

  const handleTextLayerSuccess = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;

    // react-pdf 10 renders the text layer with class `react-pdf__Page__textContent`.
    // Each text span sits as a child of that container.
    const layer = root.querySelector(
      ".react-pdf__Page__textContent",
    ) as HTMLElement | null;
    if (!layer) {
      setMatchOutcome("fallback");
      return;
    }

    const spans = Array.from(layer.querySelectorAll<HTMLElement>("span"));
    const texts = spans.map((s) => s.textContent ?? "");

    const result = matchSnippet(texts, snippet);
    if (
      !result.matched ||
      result.startSpan === null ||
      result.endSpan === null
    ) {
      setMatchOutcome("fallback");
      return;
    }

    for (let i = result.startSpan; i < result.endSpan; i++) {
      const span = spans[i];
      if (!span) continue;
      span.style.backgroundColor = "rgba(254, 240, 138, 0.6)";
      span.style.borderRadius = "2px";
      span.style.boxShadow = "0 0 0 1px rgba(254, 240, 138, 0.6)";
    }

    const first = spans[result.startSpan];
    if (first) {
      requestAnimationFrame(() => {
        first.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    setMatchOutcome("matched");
  }, [snippet]);

  // When page or snippet changes, reset state so the next render runs the
  // matcher again.
  useEffect(() => {
    setPageLoaded(false);
    setMatchOutcome("pending");
  }, [page, snippet, source]);

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-auto rounded-md border border-line bg-base"
    >
      {matchOutcome === "fallback" ? (
        <div className="sticky top-0 z-10 flex items-start gap-2 border-b border-sev-monitor/30 bg-sev-monitor/[0.06] px-4 py-2.5 text-xs">
          <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-sev-monitor" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">
              Snippet not pinpointed on this page.
            </p>
            <p
              className="mt-1 inline-block rounded-sm px-1 py-[2px] italic leading-tight text-ink"
              style={{ backgroundColor: "rgba(254, 240, 138, 0.6)" }}
            >
              “{snippet}”
            </p>
          </div>
        </div>
      ) : null}
      <Document
        file={file}
        loading={<PdfLoadingState />}
        error={<PdfErrorState />}
        className="flex w-full justify-center bg-base p-4"
      >
        <Page
          pageNumber={page}
          width={520}
          onLoadSuccess={() => setPageLoaded(true)}
          onRenderTextLayerSuccess={handleTextLayerSuccess}
          renderTextLayer
          renderAnnotationLayer={false}
          loading={<PdfLoadingState />}
          className="overflow-hidden rounded-sm border border-line bg-surface shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
        />
      </Document>
      {!pageLoaded ? null : null}
    </div>
  );
}

function PdfLoadingState() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-ink-subtle">
      Loading page…
    </div>
  );
}

function PdfErrorState() {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm font-medium text-ink">Couldn&apos;t load PDF.</p>
      <p className="max-w-xs text-xs text-ink-muted">
        The source document is unavailable. Snippet still readable above.
      </p>
    </div>
  );
}
