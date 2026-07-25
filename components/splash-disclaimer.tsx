"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "chronicle.splashDismissed.v1";

// The splash is a browser-only "show once" gate backed by localStorage. Reading
// localStorage during render/hydration would cause a mismatch (the server can't
// see it), so we expose it as an external store and read it via
// useSyncExternalStore: getServerSnapshot renders nothing on the server, then
// the real client snapshot fills in right after hydration — same visible timing
// as the previous mount effect, without the flagged synchronous setState.
//
// `sessionDismissed` is an in-memory latch so that clicking "I understand" still
// closes the dialog for the session even if localStorage.setItem throws (private
// mode / quota) — matching the original unconditional close.
let sessionDismissed = false;
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): boolean {
  if (sessionDismissed) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Storage blocked → treat as not-dismissed (show the splash), matching the
    // original effect's catch branch.
    return false;
  }
}

function getServerSnapshot(): boolean {
  // No localStorage on the server → render nothing (the original initial state).
  return true;
}

function dismissSplash(): void {
  sessionDismissed = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // best-effort; the in-memory latch still closes it for this session
  }
  listeners.forEach((l) => l());
}

export function SplashDisclaimer() {
  const dismissed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  if (dismissed) return null;

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
            onClick={dismissSplash}
            className="chronicle-cta-teal rounded-md bg-accent-teal px-5 py-2 text-sm font-medium text-white hover:bg-accent-teal/95"
          >
            I understand
          </button>
        </div>
      </div>
    </div>
  );
}
