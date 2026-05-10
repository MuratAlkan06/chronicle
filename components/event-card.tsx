"use client";

import {
  Activity,
  ArrowRightLeft,
  ClipboardList,
  FileText,
  FlaskConical,
  Pill,
  ScanLine,
  Stethoscope,
} from "lucide-react";
import type { TimelineEvent } from "@/lib/schema";

interface EventCardProps {
  event: TimelineEvent;
  side: "left" | "right";
  active?: boolean;
  onSelect: (event: TimelineEvent) => void;
}

export function EventCard({ event, side, active, onSelect }: EventCardProps) {
  const Icon = eventTypeIcon(event.event_type);
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className={`group relative w-full overflow-hidden rounded-md border bg-surface text-left transition-all duration-150 hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)] ${
        active
          ? "border-accent-teal shadow-[0_4px_12px_rgba(15,118,110,0.15)]"
          : "border-line"
      }`}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: severityColor(event.severity) }}
      />
      <div className="flex items-start gap-3 px-4 py-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-base text-ink-muted"
        >
          <Icon className="h-4 w-4" strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-[11px] text-ink-subtle">
              {formatDate(event.date, event.date_confidence)}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-subtle">
              {event.event_type}
            </span>
          </div>
          <p className="mt-1 text-[14px] font-medium leading-snug text-ink">
            {event.title}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            {event.summary}
          </p>
          <p className="mt-2 truncate font-mono text-[10px] tracking-wider text-ink-subtle">
            {event.source.document_id} · p.{event.source.page} · click to view
          </p>
        </div>
      </div>
      {/* Side-pointing tail nub so the card visually anchors to the axis dot. */}
      <span
        aria-hidden
        className={`absolute top-6 h-px w-3 bg-line ${
          side === "left" ? "right-0 translate-x-full" : "left-0 -translate-x-full"
        }`}
      />
    </button>
  );
}

function severityColor(s: TimelineEvent["severity"]): string {
  switch (s) {
    case "info":
      return "var(--color-sev-info)";
    case "monitor":
      return "var(--color-sev-monitor)";
    case "concerning":
      return "var(--color-sev-concerning)";
    case "urgent":
      return "var(--color-sev-urgent)";
  }
}

function eventTypeIcon(t: TimelineEvent["event_type"]) {
  switch (t) {
    case "lab":
      return FlaskConical;
    case "imaging":
      return ScanLine;
    case "visit":
      return Stethoscope;
    case "diagnosis":
      return ClipboardList;
    case "medication":
      return Pill;
    case "procedure":
      return Activity;
    case "referral":
      return ArrowRightLeft;
    default:
      return FileText;
  }
}

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
