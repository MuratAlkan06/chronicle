"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "chronicle.splashDismissed.v1";

export function SplashDisclaimer() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== "1") {
        setOpen(true);
      }
    } catch {
      setOpen(true);
    }
  }, []);

  if (!open) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // best-effort; still close
    }
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="chronicle-splash-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4"
    >
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-[0_10px_40px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]">
        <h2
          id="chronicle-splash-title"
          className="font-serif text-[22px] leading-tight text-ink"
        >
          Before you start
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Chronicle organizes your records for conversations with your doctor.
          It is <span className="text-ink">not medical advice</span>. Severity
          reflects suggested discussion priority, not clinical urgency.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Sample patient cases are illustrative. Drop-in PDFs stay in memory
          for this session only.
        </p>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md bg-accent-teal px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-teal/90"
          >
            I understand
          </button>
        </div>
      </div>
    </div>
  );
}
