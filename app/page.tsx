"use client";

import Link from "next/link";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, LineChart, Upload } from "lucide-react";
import { HeroScrollBoard } from "@/components/blocks/hero-scroll-board";

const EASE = [0.16, 1, 0.3, 1] as const;
const SECTION_MAX = "max-w-[1200px]";

export default function LandingPage() {
  return (
    <div className="relative flex flex-1 flex-col bg-base">
      {/* Global noise texture — fixed-position overlay for tactile depth.
          z-0, pointer-events-none, content sits at z-10. */}
      <div
        aria-hidden
        className="chronicle-noise pointer-events-none fixed inset-0 z-0"
      />
      <div className="relative z-10 flex flex-1 flex-col">
        <TopNav />
        <main>
          <Hero />
          <HeroScrollBoard />
          <SectionDivider index="01" label="Problem" />
          <Problem />
          <SectionDivider index="02" label="Method" />
          <Method />
          <SectionDivider index="03" label="Trust" />
          <Trust />
          <SectionDivider index="04" label="Start" />
          <FinalCta />
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top nav — single hairline, wordmark left, minimal right.
// ---------------------------------------------------------------------------

function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-base/80 backdrop-blur-md">
      <div
        className={`mx-auto flex w-full ${SECTION_MAX} items-center justify-between px-8 py-4`}
      >
        <span className="font-serif text-[20px] leading-none tracking-tight text-ink">
          Chronicle
        </span>
        <nav className="flex items-center gap-7">
          <Link
            href="/eval"
            className="hidden text-[13px] font-medium text-ink-muted transition-colors duration-150 hover:text-ink md:inline"
          >
            Evaluation
          </Link>
          <Link
            href="/app"
            className="chronicle-cta-ink inline-flex items-center justify-center rounded-md bg-ink px-3.5 py-1.5 text-[13px] font-medium text-base hover:bg-ink/90"
          >
            Open app
          </Link>
        </nav>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Hero — large editorial headline, restrained subhead, single CTA, hero shot
// ---------------------------------------------------------------------------

function Hero() {
  const reduce = useReducedMotion();
  const fade = (delay: number) =>
    reduce
      ? { initial: false, animate: false }
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: EASE },
        };

  return (
    <section className="relative overflow-hidden border-b border-line bg-base">
      <DotGrid />
      <div
        className={`relative mx-auto w-full ${SECTION_MAX} px-8 pb-28 pt-24 md:pb-32 md:pt-28`}
      >
        <motion.p
          {...fade(0)}
          className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-subtle"
        >
          A patient-side timeline tool
        </motion.p>

        <h1 className="mt-7 max-w-[14ch] text-[clamp(56px,9vw,104px)] font-semibold leading-[0.96] tracking-[-0.035em] text-ink">
          <KineticHeadline
            text="Your medical records, on one timeline."
            startDelay={0.08}
          />
        </h1>

        <motion.p
          {...fade(0.18)}
          className="mt-8 max-w-[44ch] text-[19px] leading-[1.45] text-ink-muted"
        >
          Patients carry 30 documents from 5 doctors. Chronicle reads them in
          parallel and ties them together — every event traceable to a verbatim
          quote on a specific page.
        </motion.p>

        <motion.div
          {...fade(0.28)}
          className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3"
        >
          <Link
            href="/app"
            className="chronicle-cta-teal inline-flex items-center gap-2 rounded-md bg-accent-teal px-5 py-2.5 text-[14px] font-medium text-white hover:bg-accent-teal/95"
          >
            Get started
            <span aria-hidden className="text-[15px]">
              →
            </span>
          </Link>
          <Link
            href="/eval"
            className="inline-flex items-center gap-2 text-[14px] font-medium text-ink transition-colors duration-150 hover:text-ink-muted"
          >
            <span>See evaluation</span>
            <span
              aria-hidden
              className="font-mono text-[11px] tracking-wider text-ink-subtle"
            >
              ↗
            </span>
          </Link>
        </motion.div>

        <motion.div
          {...(reduce
            ? { initial: false, animate: false }
            : {
                initial: { opacity: 0, y: 28 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.9, delay: 0.42, ease: EASE },
              })}
          className="relative mt-20"
        >
          <ProductPreview />
        </motion.div>
      </div>
    </section>
  );
}

function DotGrid() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, #E5E5E0 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 50%, transparent 25%, var(--color-base) 95%)",
        }}
      />
    </>
  );
}

function ProductPreview() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-20"
        style={{
          background:
            "radial-gradient(ellipse 55% 50% at 50% 55%, rgba(15,118,110,0.12), transparent 70%)",
          filter: "blur(48px)",
        }}
      />
      <div className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-[0_24px_60px_-24px_rgba(15,23,42,0.20),0_2px_8px_rgba(15,23,42,0.05)]">
        <div className="flex items-center justify-between border-b border-line bg-base/60 px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-line" />
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-line" />
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-line" />
          </div>
          <span className="font-mono text-[11px] tracking-wider text-ink-subtle">
            chronicle.app/app — Sarah Chen, 47F
          </span>
          <span className="w-12" aria-hidden />
        </div>
        <AppMockup />
      </div>
      <style>{`
        @keyframes chronicle-snippet-pulse {
          0%   { opacity: 0; }
          18%  { opacity: 1; }
          50%  { opacity: 1; }
          70%  { opacity: 0; }
          100% { opacity: 0; }
        }
        .snippet-pulse {
          opacity: 0;
          animation: chronicle-snippet-pulse 5s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .snippet-pulse { animation: none; opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}

// Hand-built mockup of /app — a stylized representation that conveys the
// product (timeline + side panel + verbatim snippet highlight) before the
// real H10/H11 screenshot lands.
function AppMockup() {
  type Severity = "info" | "monitor" | "concerning";
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { once: true, margin: "-50px" });
  // After all events stagger in, flip the active card's "selected" treatment.
  const [settled, setSettled] = useState(reduce ?? false);
  useEffect(() => {
    if (!inView || reduce) return;
    const t = setTimeout(() => setSettled(true), 2700);
    return () => clearTimeout(t);
  }, [inView, reduce]);

  const events: Array<{
    date: string;
    type: string;
    title: string;
    sev: Severity;
    active?: boolean;
  }> = [
    {
      date: "Apr 18, 2023",
      type: "LAB",
      title: "HbA1c — 8.4 % (high)",
      sev: "concerning",
      active: true,
    },
    {
      date: "Apr 18, 2023",
      type: "VISIT",
      title: "PCP follow-up — diabetes management",
      sev: "info",
    },
    {
      date: "Mar 28, 2023",
      type: "MEDICATION",
      title: "Started metformin 500 mg b.i.d.",
      sev: "monitor",
    },
    {
      date: "Jan 12, 2023",
      type: "DIAGNOSIS",
      title: "Type 2 diabetes mellitus (E11.9)",
      sev: "concerning",
    },
    {
      date: "Jan 12, 2023",
      type: "LAB",
      title: "Fasting glucose — 187 mg/dL",
      sev: "concerning",
    },
    {
      date: "Jan 12, 2023",
      type: "VISIT",
      title: "PCP visit — initial workup",
      sev: "info",
    },
  ];

  return (
    <div ref={rootRef} className="grid grid-cols-12 bg-base">
      {/* Left: timeline list */}
      <div className="col-span-7 border-r border-line bg-base p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-[14px] font-semibold text-ink">Events</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-subtle">
            18 extracted · 7 docs
          </p>
        </div>
        <ul className="mt-4 space-y-2">
          {events.map((e, i) => (
            <motion.li
              key={i}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={
                reduce
                  ? false
                  : inView
                    ? { opacity: 1, y: 0 }
                    : { opacity: 0, y: 8 }
              }
              transition={{
                duration: 0.45,
                delay: reduce ? 0 : i * 0.32,
                ease: EASE,
              }}
              className={`relative flex items-start gap-3 overflow-hidden rounded-md border px-3.5 py-2.5 transition-colors duration-300 ${
                e.active && settled
                  ? "border-accent-teal/40 bg-accent-teal/[0.04]"
                  : "border-line bg-surface"
              }`}
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[3px]"
                style={{ backgroundColor: severityHex(e.sev) }}
              />
              <span
                aria-hidden
                className="mt-0.5 h-5 w-5 shrink-0 rounded-sm border border-line bg-base"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-[10px] text-ink-subtle">
                    {e.date}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-ink-subtle">
                    {e.type}
                  </span>
                  <span
                    className="font-mono text-[9px] uppercase tracking-wider"
                    style={{ color: severityHex(e.sev) }}
                  >
                    {e.sev}
                  </span>
                </div>
                <p className="mt-0.5 text-[12.5px] font-medium leading-snug text-ink">
                  {e.title}
                </p>
              </div>
            </motion.li>
          ))}
        </ul>
      </div>

      {/* Right: side panel */}
      <div className="col-span-5 bg-surface p-5">
        <div className="flex items-center justify-between">
          <span
            className="rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
            style={{
              color: severityHex("concerning"),
              backgroundColor: "rgba(220,38,38,0.08)",
            }}
          >
            Concerning
          </span>
          <span className="font-mono text-[10px] text-ink-subtle">
            ev_04 · ↗ source
          </span>
        </div>
        <h4 className="mt-3 text-[15px] font-semibold leading-tight text-ink">
          HbA1c — 8.4 % (high)
        </h4>
        <p className="mt-1 font-mono text-[10px] text-ink-subtle">
          Apr 18, 2023 · Sarah Levy, MD
        </p>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
          Glycated hemoglobin elevated above the 5.6% reference ceiling,
          consistent with poorly-controlled Type 2 diabetes.
        </p>

        {/* PDF source preview */}
        <div className="mt-4 overflow-hidden rounded-md border border-line bg-base">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 font-mono text-[10px] text-ink-subtle">
            <span>d2_pcp_2023_04.pdf</span>
            <span>p. 2</span>
          </div>
          <div className="space-y-1.5 p-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-[6px] rounded-sm bg-line/60" />
            ))}
            <div className="relative pt-1.5">
              <span
                className="snippet-pulse pointer-events-none absolute inset-0"
                aria-hidden
                style={{
                  backgroundColor: "rgba(254, 240, 138, 0.55)",
                  borderRadius: "2px",
                }}
              />
              <span className="relative inline-block text-[11px] leading-tight text-ink">
                Hemoglobin A1c: 8.4 % (H). Reference 4.0–5.6 %.
              </span>
            </div>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-[6px] rounded-sm bg-line/60" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function severityHex(s: "info" | "monitor" | "concerning"): string {
  switch (s) {
    case "info":
      return "#6B7280";
    case "monitor":
      return "#D97706";
    case "concerning":
      return "#DC2626";
  }
}

// ---------------------------------------------------------------------------
// Section divider — full-width hairline with mono index/label centered on top
// ---------------------------------------------------------------------------

function SectionDivider({ index, label }: { index: string; label: string }) {
  return (
    <div className="bg-base">
      {/* Soft gradient line at the top — replaces a hard hairline transition
          with the gradient divider explicitly allowed by FRONTEND-STANDARDS §H.1. */}
      <div aria-hidden className="chronicle-soft-divider" />
      <div className={`mx-auto w-full ${SECTION_MAX} px-8`}>
        <div className="grid grid-cols-12 items-center gap-6 py-5">
          <span className="col-span-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-subtle">
            {index} · {label}
          </span>
          <span aria-hidden className="col-span-10 h-px bg-line" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Problem — bare hairline-driven stat list. No card chrome.
// ---------------------------------------------------------------------------

function Problem() {
  const stats = [
    {
      to: 30,
      suffix: "+",
      label: "documents per chronic-condition patient",
    },
    {
      to: 5,
      suffix: "",
      label: "providers across the average care network",
    },
    {
      to: 0,
      suffix: "",
      label: "places where they're tied together",
    },
  ];
  return (
    <Section>
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 md:col-span-5">
          <SectionEntrance>
            <h2 className="text-[clamp(40px,5.5vw,64px)] font-semibold leading-[1.02] tracking-[-0.03em] text-ink">
              Records are
              <br />
              everywhere.
            </h2>
            <p className="mt-6 max-w-[36ch] text-[17px] leading-relaxed text-ink-muted">
              The fragmentation isn&apos;t a content problem — it&apos;s a
              routing problem. No system aggregates the patient&apos;s view
              across providers.
            </p>
          </SectionEntrance>
        </div>
        <div className="col-span-12 md:col-span-7 md:pl-8">
          <ul className="divide-y divide-line border-y border-line">
            {stats.map((s, i) => (
              <SectionEntrance key={s.label} delay={0.05 + i * 0.07}>
                <li className="grid grid-cols-12 items-baseline gap-4 py-7">
                  <span className="col-span-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-subtle">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <CountUp
                    to={s.to}
                    suffix={s.suffix}
                    className="col-span-3 text-[44px] font-semibold leading-none tracking-[-0.03em] text-ink tabular-nums"
                  />
                  <span className="col-span-7 text-[15px] leading-snug text-ink-muted">
                    {s.label}
                  </span>
                </li>
              </SectionEntrance>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Method — three sequential rows, each with a step number, title, body
// ---------------------------------------------------------------------------

// Bento grid adapted from 21st.dev BentoGridWithFeatures pattern. Hairline
// dividers between cells (no card-borders or shadows), locked tokens only.
// Layout: 2 + 4 in row 1, 6 in row 2 (row 2 cell shows a mini timeline preview).

function Method() {
  return (
    <Section tone="warm">
      <SectionEntrance>
        <h2 className="text-[clamp(40px,5.5vw,64px)] font-semibold leading-[1.02] tracking-[-0.03em] text-ink">
          Three steps. <span className="text-ink-subtle">Verifiable.</span>
        </h2>
      </SectionEntrance>

      <div className="mt-16 overflow-hidden rounded-lg border border-line">
        <div className="grid grid-cols-1 md:grid-cols-6">
          {/* Cell 1 — Drop (col-span-2) */}
          <SectionEntrance className="border-b border-line md:col-span-2 md:border-b-0 md:border-r">
            <BentoCell
              step="01"
              Icon={Upload}
              title="Drop your records."
              body="Multi-document PDF upload. Files stay on-device — Chronicle never persists them."
              caption="Browser-only · multipart upload"
            />
          </SectionEntrance>

          {/* Cell 2 — Read (col-span-4, wider, gets a faux extraction visual) */}
          <SectionEntrance delay={0.07} className="border-b border-line md:col-span-4">
            <BentoCell
              step="02"
              Icon={Eye}
              title="Read in parallel."
              body="Claude Sonnet 4.6 extracts dates, diagnoses, labs, and visits from each PDF concurrently. Every event ships with a verbatim source quote and page number."
              caption="Sonnet 4.6 · parallel extraction · 8-way concurrency"
              wide
            >
              <ExtractionPreview />
            </BentoCell>
          </SectionEntrance>

          {/* Cell 3 — See (full row, col-span-6, mini timeline visual) */}
          <SectionEntrance delay={0.14} className="md:col-span-6">
            <BentoCell
              step="03"
              Icon={LineChart}
              title="See the throughline."
              body="Events stream into a date-sorted timeline as documents complete. Click any card to jump to the exact paragraph it came from in the source PDF."
              caption="Server-Sent Events · click-to-source highlight"
              wide
            >
              <TimelinePreview />
            </BentoCell>
          </SectionEntrance>
        </div>
      </div>
    </Section>
  );
}

interface BentoCellProps {
  step: string;
  Icon: typeof Upload;
  title: string;
  body: string;
  caption: string;
  wide?: boolean;
  children?: ReactNode;
}

function BentoCell({
  step,
  Icon,
  title,
  body,
  caption,
  wide,
  children,
}: BentoCellProps) {
  return (
    <div
      className={`group/cell flex h-full flex-col p-8 transition-colors duration-200 hover:bg-surface ${
        wide ? "md:p-10" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-md border border-accent-teal/20 text-accent-teal transition-colors duration-200 group-hover/cell:border-accent-teal/40"
          style={{
            backgroundColor: "rgba(15,118,110,0.06)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -1px 0 rgba(15,118,110,0.06)",
          }}
        >
          <Icon className="h-4 w-4" strokeWidth={1.6} aria-hidden />
        </span>
        <BentoStepBadge step={step} />
      </div>
      <h3 className="mt-7 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
        {title}
      </h3>
      <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-ink-muted">
        {body}
      </p>
      <p className="mt-5 font-mono text-[11px] leading-relaxed tracking-wide text-ink-subtle">
        {caption}
      </p>
      {children ? <div className="mt-7 flex-1">{children}</div> : null}
    </div>
  );
}

// Step indicator with animated progress segments — cell N fills N of 3 bars.
function BentoStepBadge({ step }: { step: string }) {
  const reduce = useReducedMotion();
  const current = parseInt(step, 10);
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-subtle">
        {step} / 03
      </span>
      <div className="flex gap-1">
        {[1, 2, 3].map((n) => {
          const filled = n <= current;
          return (
            <motion.span
              key={n}
              aria-hidden
              className="block h-[2px] w-4"
              style={{
                backgroundColor: filled
                  ? "var(--color-accent-teal)"
                  : "var(--color-line)",
                transformOrigin: "left center",
              }}
              initial={reduce ? false : { scaleX: 0 }}
              whileInView={reduce ? undefined : { scaleX: 1 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{
                duration: 0.4,
                delay: reduce ? 0 : 0.25 + n * 0.08,
                ease: EASE,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// Faux extraction preview — shows a PDF-icon → events-list flow, suggests
// what "Read in parallel" outputs without depending on real data.
function ExtractionPreview() {
  return (
    <div className="grid grid-cols-5 items-center gap-4 rounded-md border border-line bg-base p-5">
      <div className="col-span-2 space-y-2">
        {[
          { label: "d1_pcp_2023_01.pdf", active: true },
          { label: "d2_lab_2023_04.pdf" },
          { label: "d3_pcp_2023_05.pdf" },
        ].map((d) => (
          <div
            key={d.label}
            className={`flex items-center gap-2 rounded-sm border px-2 py-1.5 ${
              d.active
                ? "border-accent-teal/40 bg-accent-teal/[0.04]"
                : "border-line bg-surface"
            }`}
          >
            <span className="h-3 w-3 shrink-0 rounded-sm bg-line/60" aria-hidden />
            <span className="truncate font-mono text-[10px] tracking-wider text-ink-muted">
              {d.label}
            </span>
          </div>
        ))}
      </div>
      <div className="col-span-1 flex justify-center">
        <span
          aria-hidden
          className="font-mono text-[14px] text-ink-subtle"
        >
          →
        </span>
      </div>
      <div className="col-span-2 space-y-2">
        {[
          { type: "LAB", title: "HbA1c — 9.2%", sev: "#DC2626" },
          { type: "VISIT", title: "PCP visit", sev: "#6B7280" },
          { type: "MED", title: "Started metformin", sev: "#D97706" },
        ].map((e) => (
          <div
            key={e.title}
            className="relative overflow-hidden rounded-sm border border-line bg-surface px-2 py-1.5"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-[3px]"
              style={{ backgroundColor: e.sev }}
            />
            <div className="flex items-baseline gap-2 pl-1">
              <span
                className="font-mono text-[8px] tracking-wider"
                style={{ color: e.sev }}
              >
                {e.type}
              </span>
              <span className="truncate text-[10px] font-medium text-ink">
                {e.title}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Mini timeline preview — horizontal axis with severity-colored dots.
function TimelinePreview() {
  const dots = [
    { label: "Jan '23", sev: "#6B7280" },
    { label: "Apr '23", sev: "#DC2626" },
    { label: "Jul '23", sev: "#6B7280" },
    { label: "Nov '23", sev: "#D97706" },
    { label: "Mar '24", sev: "#DC2626" },
    { label: "Jul '24", sev: "#6B7280" },
  ];
  return (
    <div className="rounded-md border border-line bg-base p-6">
      <div className="relative h-16">
        <span
          aria-hidden
          className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-line"
        />
        <div className="absolute left-0 right-0 top-1/2 flex -translate-y-1/2 justify-between">
          {dots.map((d, i) => (
            <span key={i} className="relative flex flex-col items-center">
              <span
                className="block h-3 w-3 rounded-full border-2 bg-base"
                style={{ borderColor: d.sev }}
              >
                <span
                  className="block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: d.sev, marginTop: 1, marginLeft: 1 }}
                />
              </span>
              <span className="mt-3 font-mono text-[10px] tracking-wider text-ink-subtle">
                {d.label}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trust — wide PDF mock, two-column with copy left and proof right
// ---------------------------------------------------------------------------

function Trust() {
  return (
    <Section tone="surface">
      {/* Ambient teal glow — mirrors the hero's signature element. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-32"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 60%, rgba(15,118,110,0.08), transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      <SectionEntrance>
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-[clamp(40px,5.5vw,64px)] font-semibold leading-[1.02] tracking-[-0.03em] text-ink">
            Every claim, <span className="text-ink-subtle">traceable.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-[52ch] text-[17px] leading-relaxed text-ink-muted">
            Chronicle never paraphrases. Each timeline event carries the exact
            sentence the model saw, the page it came from, and a one-click jump
            back to the source — verifiable end-to-end.
          </p>
        </div>
      </SectionEntrance>

      <div className="relative mt-16">
        <TraceFlow />
      </div>

      <SectionEntrance delay={0.3}>
        <ul className="mt-12 grid grid-cols-1 gap-6 border-t border-line pt-8 font-mono text-[12px] leading-relaxed text-ink-subtle md:grid-cols-3">
          <li className="flex items-start gap-2">
            <span className="text-accent-teal">—</span>
            <span>Verbatim source snippet on every event</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-teal">—</span>
            <span>Click-to-source PDF jump with text-layer highlight</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-teal">—</span>
            <span>Held-out evaluation on an unseen case</span>
          </li>
        </ul>
      </SectionEntrance>
    </Section>
  );
}

// 3-stage trace: source PDF → matched event → patient explanation. Each stage
// is a card with a hairline arrow connector. SectionEntrance staggers the
// reveal so the trace appears to flow left → right as you scroll into view.

function TraceFlow() {
  return (
    <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
      <SectionEntrance delay={0.05}>
        <TraceStage tag="01 · Source" label="d2_pcp_2023_04.pdf · p.2">
          <SourceCard />
        </TraceStage>
      </SectionEntrance>

      <ConnectorArrow caption="match" />

      <SectionEntrance delay={0.18}>
        <TraceStage tag="02 · Event" label="emit_events tool output">
          <EventCard />
        </TraceStage>
      </SectionEntrance>

      <ConnectorArrow caption="explain" />

      <SectionEntrance delay={0.31}>
        <TraceStage tag="03 · Patient view" label="Gemini Flash · 2-3 sentences">
          <PatientCard />
        </TraceStage>
      </SectionEntrance>
    </div>
  );
}

function TraceStage({
  tag,
  label,
  children,
}: {
  tag: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-subtle">
          {tag}
        </p>
        <p className="truncate font-mono text-[10px] tracking-wider text-ink-subtle">
          {label}
        </p>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function ConnectorArrow({ caption }: { caption: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="hidden flex-col items-center justify-center md:flex">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
        {caption}
      </span>
      <svg
        width="80"
        height="14"
        viewBox="0 0 80 14"
        className="mt-2 text-line"
        aria-hidden
      >
        {/* Draw-on dashed line, then fade-in arrowhead. */}
        <motion.line
          x1="0"
          y1="7"
          x2="68"
          y2="7"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 3"
          initial={reduce ? false : { pathLength: 0 }}
          whileInView={reduce ? undefined : { pathLength: 1 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.7, ease: EASE }}
        />
        <motion.path
          d="M 68 2 L 76 7 L 68 12 Z"
          fill="currentColor"
          initial={reduce ? false : { opacity: 0 }}
          whileInView={reduce ? undefined : { opacity: 0.6 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.3, delay: 0.65, ease: EASE }}
        />
      </svg>
    </div>
  );
}

function SourceCard() {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 font-mono text-[10px] tracking-wider text-ink-subtle">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-line" />
          <span className="truncate">d2_pcp_2023_04.pdf</span>
        </div>
        <span>p.2</span>
      </div>
      <div className="space-y-1.5 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-[6px] rounded-sm bg-line/60" />
        ))}
        <div className="pt-2">
          <span
            className="inline-block rounded-sm px-1 py-[2px] text-[11px] leading-snug text-ink"
            style={{ backgroundColor: "rgba(254, 240, 138, 0.6)" }}
          >
            Hemoglobin A1c: 8.4 % (H). Reference 4.0–5.6 %.
          </span>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-[6px] rounded-sm bg-line/60" />
        ))}
      </div>
    </div>
  );
}

function EventCard() {
  return (
    <div className="relative h-full overflow-hidden rounded-md border border-line bg-surface shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: "#DC2626" }}
      />
      <div className="p-4 pl-5">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] tracking-wider text-ink-subtle">
            Apr 18, 2023
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-subtle">
            LAB
          </span>
          <span
            className="font-mono text-[9px] uppercase tracking-wider"
            style={{ color: "#DC2626" }}
          >
            concerning
          </span>
        </div>
        <p className="mt-2 text-[13px] font-semibold leading-tight text-ink">
          HbA1c — 8.4 % (high)
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
          Glycated hemoglobin elevated above the 5.6% reference ceiling.
        </p>
        <div className="mt-3 rounded-sm border border-line bg-base px-2 py-1.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-ink-subtle">
            source.snippet
          </p>
          <p className="mt-1 truncate text-[10.5px] italic text-ink-muted">
            “Hemoglobin A1c: 8.4 % (H). Reference 4.0–5.6 %.”
          </p>
        </div>
      </div>
    </div>
  );
}

function PatientCard() {
  return (
    <div className="h-full overflow-hidden rounded-md border border-line bg-surface shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
      <div className="border-b border-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
        Patient view · ev_04
      </div>
      <div className="p-4">
        <p className="text-[12.5px] leading-relaxed text-ink">
          Your A1c reflects average blood sugar over the past three months.
          A value above 5.6% is flagged as elevated.
        </p>
        <p className="mt-3 font-mono text-[10px] tracking-wider text-accent-teal">
          ↳ no recommendation, no &quot;should&quot;
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Final CTA — minimal, flush, single button
// ---------------------------------------------------------------------------

function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-line bg-base">
      {/* Ambient teal glow — recurring signature. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-32"
        style={{
          background:
            "radial-gradient(ellipse 45% 50% at 50% 50%, rgba(15,118,110,0.08), transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      <div
        className={`relative mx-auto w-full ${SECTION_MAX} px-8 py-32 md:py-40`}
      >
        <SectionEntrance className="mb-16">
          <LiveMetricsStrip />
        </SectionEntrance>
        <SectionEntrance>
          <div className="grid grid-cols-12 items-end gap-8">
            <div className="col-span-12 md:col-span-8">
              <h2 className="text-[clamp(48px,7vw,88px)] font-semibold leading-[0.98] tracking-[-0.035em] text-ink">
                See your records
                <br />
                in a new light.
              </h2>
            </div>
            <div className="col-span-12 md:col-span-4 md:pl-8">
              <Link
                href="/app"
                className="chronicle-cta-teal inline-flex items-center gap-2 rounded-md bg-accent-teal px-5 py-2.5 text-[14px] font-medium text-white hover:bg-accent-teal/95"
              >
                Get started
                <span aria-hidden className="text-[15px]">
                  →
                </span>
              </Link>
              <p className="mt-4 max-w-[28ch] font-mono text-[11px] leading-relaxed tracking-wide text-ink-subtle">
                A sample case loads in under thirty seconds. No signup.
              </p>
            </div>
          </div>
        </SectionEntrance>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer — multi-column, monospace captions, hairline rule
// ---------------------------------------------------------------------------

function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-line bg-base">
      <div className={`mx-auto w-full ${SECTION_MAX} px-8 pb-0 pt-16`}>
        <div className="relative grid grid-cols-12 gap-6">
          <div className="col-span-12 md:col-span-4">
            <span className="font-serif text-[22px] leading-none tracking-tight text-ink">
              Chronicle
            </span>
            <p className="mt-4 max-w-[36ch] text-[13px] leading-relaxed text-ink-muted">
              A patient-side timeline tool. Built at HackDavis 2026.
            </p>
          </div>
          <div className="col-span-6 md:col-span-3">
            <FooterCol
              label="Product"
              items={[
                { href: "/app", text: "Open app" },
                { href: "/eval", text: "Evaluation" },
              ]}
            />
          </div>
          <div className="col-span-6 md:col-span-3">
            <FooterCol
              label="Built with"
              items={[
                { text: "Claude Sonnet 4.6" },
                { text: "Voyage · Gemini Flash" },
                { text: "Next.js 16 · React 19" },
              ]}
            />
          </div>
          <div className="col-span-12 md:col-span-2">
            <FooterCol
              label="Author"
              items={[
                {
                  href: "https://github.com/muratalkan06",
                  text: "muratalkan06",
                },
              ]}
            />
          </div>
        </div>

        {/* Oversized wordmark — vertical fade from ink/15 → transparent.
            Sits behind the bottom strip, anchored to the footer base. */}
        <div
          aria-hidden
          className="pointer-events-none mt-10 select-none text-center font-serif font-semibold leading-[0.85] tracking-[-0.04em]"
          style={{
            fontSize: "clamp(7rem, 22vw, 18rem)",
            background:
              "linear-gradient(to bottom, rgba(10,10,10,0.18) 0%, rgba(10,10,10,0.06) 60%, transparent 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          Chronicle
        </div>

        {/* Bottom strip — sits over the bottom of the wordmark on a thin
            ruling that anchors copyright + disclaimer. */}
        <div className="relative mt-[-2.5rem] flex flex-col items-center justify-between gap-2 border-t border-line bg-base pb-8 pt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-subtle md:flex-row">
          <span>© 2026 Chronicle</span>
          <span>Not medical advice. Informational use only.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  label,
  items,
}: {
  label: string;
  items: Array<{ text: string; href?: string }>;
}) {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-subtle">
        {label}
      </p>
      <ul className="mt-4 space-y-2">
        {items.map((it) => (
          <li key={it.text} className="text-[13px] text-ink-muted">
            {it.href ? (
              <Link
                href={it.href}
                className="transition-colors duration-150 hover:text-ink"
              >
                {it.text}
              </Link>
            ) : (
              it.text
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LiveMetricsStrip — surfaces real /eval numbers above the final CTA.
// Numbers are from data/eval_reports/case[12].json (strict F1 + n_gt). They
// don't change between commits at this point in the build, so they're
// hardcoded here. Update if prompts/CHANGELOG.md gets a new active entry.
// ---------------------------------------------------------------------------

function LiveMetricsStrip() {
  const reduce = useReducedMotion();
  const metrics = [
    { value: 0.77, label: "Strict F1 · Sarah Chen", sub: "13 GT events" },
    { value: 0.88, label: "Strict F1 · Maria Rodriguez", sub: "8 GT events" },
    { value: 0.82, label: "Average · iterated", sub: "v1 → v4 +27pt" },
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-subtle">
        Measured · prompts/CHANGELOG.md
      </p>
      <div className="mt-5 grid grid-cols-1 gap-4 border-y border-line py-7 sm:grid-cols-3">
        {metrics.map((m, i) => (
          <div key={m.label} className="relative">
            {i > 0 ? (
              <span
                aria-hidden
                className="absolute left-0 top-1 hidden h-full w-px bg-line sm:block"
                style={{ left: "-0.5rem" }}
              />
            ) : null}
            <MetricNumber to={m.value} reduce={reduce ?? false} />
            <p className="mt-2 text-[12px] font-medium leading-tight text-ink">
              {m.label}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-subtle">
              {m.sub}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricNumber({ to, reduce }: { to: number; reduce: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const [val, setVal] = useState(reduce ? to : 0);
  useEffect(() => {
    if (reduce || !inView) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1100);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(to * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, reduce]);
  return (
    <span
      ref={ref}
      className="block text-[36px] font-semibold leading-none tracking-[-0.03em] text-ink tabular-nums"
    >
      {val.toFixed(2)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// KineticHeadline — word-by-word stagger reveal with subtle blur unwind
// ---------------------------------------------------------------------------

function KineticHeadline({
  text,
  startDelay = 0,
}: {
  text: string;
  startDelay?: number;
}) {
  const reduce = useReducedMotion();
  const words = text.split(" ");
  if (reduce) return <>{text}</>;
  return (
    <>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden align-baseline">
          <motion.span
            className="inline-block"
            initial={{ opacity: 0, y: "0.5em", filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{
              duration: 0.7,
              delay: startDelay + i * 0.06,
              ease: EASE,
            }}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// CountUp — animated number that counts from 0 → target on viewport entry
// ---------------------------------------------------------------------------

function CountUp({
  to,
  suffix = "",
  duration = 1.2,
  className,
}: {
  to: number;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const reduce = useReducedMotion();
  const [val, setVal] = useState(reduce ? to : 0);

  useEffect(() => {
    if (reduce || !inView) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / (duration * 1000));
      // ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration, reduce]);

  return (
    <span ref={ref} className={className}>
      {val}
      {suffix}
    </span>
  );
}

function Section({
  children,
  tone = "base",
  className,
}: {
  children: ReactNode;
  tone?: "base" | "surface" | "warm";
  className?: string;
}) {
  const bg =
    tone === "warm"
      ? { backgroundColor: "#F5F5F0" }
      : tone === "surface"
        ? { backgroundColor: "var(--color-surface)" }
        : { backgroundColor: "var(--color-base)" };
  return (
    <section className={`relative ${className ?? ""}`} style={bg}>
      <div
        className={`relative mx-auto w-full ${SECTION_MAX} px-8 py-24 md:py-32`}
      >
        {children}
      </div>
    </section>
  );
}

function SectionEntrance({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
