"use client";

/**
 * Timeline — vertical center axis with alternating cards (BUILD.md H4 spec).
 *
 * Layout: 12-column grid. Axis sits in column 6/7 boundary. Even-indexed
 * events (0, 2, 4 ...) anchor LEFT (cols 1-5); odd-indexed RIGHT (cols 8-12).
 * Each event has a circular date-dot on the axis, severity-colored.
 *
 * Animation per H.3 §1: AnimatePresence + per-card motion.li with `layout`
 * + initial fade-up offset, staggered by index but capped at 0.4s so a big
 * batch doesn't drag. useReducedMotion suppresses entrance + layout
 * transitions.
 */

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { TimelineEvent } from "@/lib/schema";
import { EventCard } from "@/components/event-card";

interface TimelineProps {
  events: TimelineEvent[];
  selectedId: string | null;
  onSelect: (event: TimelineEvent) => void;
}

export function Timeline({ events, selectedId, onSelect }: TimelineProps) {
  const reduce = useReducedMotion();
  if (events.length === 0) return null;

  return (
    <ol className="relative mx-auto w-full max-w-3xl">
      {/* Brushed axis line — gentle S-curve with rounded caps, draws on
          like a hand-pulled stroke when the timeline mounts. SVG stretches
          to fill the list height; preserveAspectRatio=none keeps the
          horizontal jitter intact while spanning whatever number of events. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 h-full -translate-x-1/2"
        width="6"
        viewBox="0 0 4 100"
        preserveAspectRatio="none"
      >
        <motion.path
          d="M 2 0 C 1.4 30, 2.6 60, 2 100"
          stroke="var(--color-ink-subtle)"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
          opacity="0.55"
          initial={reduce ? false : { pathLength: 0 }}
          animate={reduce ? false : { pathLength: 1 }}
          transition={{
            duration: 1.2,
            ease: [0.22, 0.61, 0.36, 1],
          }}
        />
      </svg>
      <AnimatePresence initial={false}>
        {events.map((event, i) => {
          const side = i % 2 === 0 ? "left" : "right";
          return (
            <motion.li
              key={event.id}
              layout={!reduce}
              initial={
                reduce
                  ? false
                  : { opacity: 0, x: side === "left" ? -12 : 12 }
              }
              animate={reduce ? false : { opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0 }}
              transition={{
                duration: 0.45,
                delay: reduce ? 0 : Math.min(i * 0.04, 0.4),
                ease: [0.16, 1, 0.3, 1],
              }}
              className="relative grid grid-cols-12 items-start py-3"
            >
              {/* Axis dot — same row as the card top, severity-colored. */}
              <AxisDot severity={event.severity} />

              {side === "left" ? (
                <div className="col-span-5 col-start-1 pr-6">
                  <EventCard
                    event={event}
                    side="left"
                    active={selectedId === event.id}
                    onSelect={onSelect}
                  />
                </div>
              ) : (
                <div className="col-span-5 col-start-8 pl-6">
                  <EventCard
                    event={event}
                    side="right"
                    active={selectedId === event.id}
                    onSelect={onSelect}
                  />
                </div>
              )}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

function AxisDot({ severity }: { severity: TimelineEvent["severity"] }) {
  const meta = SEVERITY_META[severity];
  return (
    <span
      className="group/dot absolute left-1/2 top-6 z-[1] flex h-3 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-base"
      style={{ borderColor: severityColor(severity) }}
      title={`Severity: ${meta.label} — ${meta.hint}`}
    >
      <span
        className="block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: severityColor(severity) }}
        aria-hidden
      />
      {/* Custom hover tooltip — no Radix needed, CSS-only with group-hover. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] leading-snug text-ink opacity-0 shadow-[0_4px_12px_rgba(15,23,42,0.08)] transition-opacity duration-150 group-hover/dot:opacity-100"
      >
        <span className="font-medium" style={{ color: severityColor(severity) }}>
          {meta.label}
        </span>
        <span className="text-ink-muted"> — {meta.hint}</span>
      </span>
    </span>
  );
}

const SEVERITY_META: Record<
  TimelineEvent["severity"],
  { label: string; hint: string }
> = {
  info: { label: "Info", hint: "context only" },
  monitor: { label: "Monitor", hint: "discuss at next visit" },
  concerning: { label: "Concerning", hint: "discuss with provider" },
  urgent: { label: "Urgent", hint: "raise promptly" },
};

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
