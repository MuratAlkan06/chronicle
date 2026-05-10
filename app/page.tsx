"use client";

import Link from "next/link";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { HeroScrollBoard } from "@/components/blocks/hero-scroll-board";

const EASE = [0.16, 1, 0.3, 1] as const;
const SECTION_MAX = "max-w-[1200px]";

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col bg-base">
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
            className="inline-flex items-center justify-center rounded-md bg-ink px-3.5 py-1.5 text-[13px] font-medium text-base transition-colors duration-150 hover:bg-ink/85"
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
            className="inline-flex items-center gap-2 rounded-md bg-accent-teal px-5 py-2.5 text-[14px] font-medium text-white shadow-[0_1px_2px_rgba(15,118,110,0.25)] transition-all duration-150 hover:-translate-y-px hover:bg-accent-teal/90 hover:shadow-[0_6px_18px_rgba(15,118,110,0.22)]"
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
    <div className="grid grid-cols-12 bg-base">
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
            <li
              key={i}
              className={`relative flex items-start gap-3 overflow-hidden rounded-md border px-3.5 py-2.5 ${
                e.active
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
            </li>
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
      <div className={`mx-auto w-full ${SECTION_MAX} px-8`}>
        <div className="grid grid-cols-12 items-center gap-6 py-5">
          <span className="col-span-2 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-subtle">
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
              The fragmentation isn't a content problem — it's a routing problem.
              No system aggregates the patient's view across providers.
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

function Method() {
  const steps = [
    {
      title: "Drop your records.",
      body: "Multi-document PDF upload. Files stay on-device — Chronicle never persists them.",
      caption: "Browser-only · multipart upload",
    },
    {
      title: "Read in parallel.",
      body: "Claude Sonnet 4.6 extracts dates, diagnoses, labs, and visits from each PDF concurrently. Every event ships with a verbatim source quote and page number.",
      caption: "Sonnet 4.6 · parallel extraction · 8-way concurrency",
    },
    {
      title: "See the throughline.",
      body: "Events stream into a date-sorted timeline as documents complete. Click any card to jump to the exact paragraph it came from in the source PDF.",
      caption: "Server-Sent Events · click-to-source highlight",
    },
  ];
  return (
    <Section>
      <SectionEntrance>
        <h2 className="text-[clamp(40px,5.5vw,64px)] font-semibold leading-[1.02] tracking-[-0.03em] text-ink">
          Three steps. <span className="text-ink-subtle">Verifiable.</span>
        </h2>
      </SectionEntrance>
      <ul className="mt-16 divide-y divide-line border-y border-line">
        {steps.map((s, i) => (
          <SectionEntrance key={s.title} delay={0.05 + i * 0.07}>
            <li className="grid grid-cols-12 gap-6 py-12">
              <div className="col-span-12 md:col-span-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-subtle">
                  Step {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <div className="col-span-12 md:col-span-7">
                <h3 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                  {s.title}
                </h3>
                <p className="mt-3 max-w-[52ch] text-[16px] leading-relaxed text-ink-muted">
                  {s.body}
                </p>
              </div>
              <div className="col-span-12 md:col-span-3 md:pl-4">
                <p className="font-mono text-[11px] leading-relaxed tracking-wide text-ink-subtle">
                  {s.caption}
                </p>
              </div>
            </li>
          </SectionEntrance>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Trust — wide PDF mock, two-column with copy left and proof right
// ---------------------------------------------------------------------------

function Trust() {
  return (
    <Section>
      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-12 md:col-span-5">
          <SectionEntrance>
            <h2 className="text-[clamp(40px,5.5vw,64px)] font-semibold leading-[1.02] tracking-[-0.03em] text-ink">
              Every claim,
              <br />
              traceable.
            </h2>
            <p className="mt-6 max-w-[40ch] text-[17px] leading-relaxed text-ink-muted">
              Chronicle never paraphrases. Each timeline event ships with the
              exact sentence the model saw, the page it came from, and a
              one-click jump back to the source PDF — line highlighted.
            </p>
            <ul className="mt-10 space-y-3 font-mono text-[12px] leading-relaxed text-ink-subtle">
              <li>— Verbatim source snippet on every event</li>
              <li>— Click-to-source PDF jump with text-layer highlight</li>
              <li>— Held-out evaluation on an unseen case</li>
            </ul>
          </SectionEntrance>
        </div>
        <div className="col-span-12 md:col-span-7">
          <SectionEntrance delay={0.12}>
            <PdfMock />
          </SectionEntrance>
        </div>
      </div>
    </Section>
  );
}

function PdfMock() {
  return (
    <div className="grid gap-3">
      <div className="overflow-hidden rounded-md border border-line bg-surface shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-[11px] tracking-wider text-ink-subtle">
            <span aria-hidden className="h-2 w-2 rounded-full bg-line" />
            d2_pcp_2023_04.pdf
          </div>
          <span className="font-mono text-[11px] tracking-wider text-ink-subtle">
            page 2 / 4
          </span>
        </div>
        <div className="space-y-2 p-6">
          {[
            "Patient: Sarah Chen, 47F",
            "Date of service: 04/18/2023",
            "Provider: Sarah Levy, MD",
          ].map((line) => (
            <div
              key={line}
              className="h-[10px] rounded-sm bg-line/70"
              aria-label={line}
            />
          ))}
          <div className="pt-5">
            <span
              className="inline-block rounded-sm px-1.5 py-[3px] text-[13px] leading-tight text-ink"
              style={{ backgroundColor: "rgba(254, 240, 138, 0.6)" }}
            >
              Hemoglobin A1c: 8.4 % (H). Reference 4.0–5.6 %.
            </span>
          </div>
          <div className="space-y-2 pt-5">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-[10px] rounded-sm bg-line/70" />
            ))}
          </div>
        </div>
      </div>
      <div className="rounded-md border border-line bg-base p-5">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-subtle">
            Patient view · auto-generated
          </p>
          <span className="font-mono text-[11px] text-ink-subtle">
            ↳ ev_04
          </span>
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-ink">
          Your A1c reflects average blood sugar over the past three months.
          A value above 5.6% is flagged as elevated.
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
    <section className="border-t border-line bg-base">
      <div
        className={`mx-auto w-full ${SECTION_MAX} px-8 py-32 md:py-40`}
      >
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
                className="inline-flex items-center gap-2 rounded-md bg-accent-teal px-5 py-2.5 text-[14px] font-medium text-white shadow-[0_1px_2px_rgba(15,118,110,0.25)] transition-all duration-150 hover:-translate-y-px hover:bg-accent-teal/90 hover:shadow-[0_6px_18px_rgba(15,118,110,0.22)]"
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
    <footer className="border-t border-line bg-base">
      <div
        className={`mx-auto w-full ${SECTION_MAX} px-8 py-12`}
      >
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 md:col-span-4">
            <span className="font-serif text-[20px] leading-none tracking-tight text-ink">
              Chronicle
            </span>
            <p className="mt-3 max-w-[32ch] text-[13px] leading-relaxed text-ink-muted">
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
                { text: "Voyage · Gemini" },
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
                  text: "github.com/muratalkan06",
                },
              ]}
            />
          </div>
        </div>
        <div className="mt-12 flex items-center justify-between border-t border-line pt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-subtle">
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

function Section({ children }: { children: ReactNode }) {
  return (
    <section className="bg-base">
      <div
        className={`mx-auto w-full ${SECTION_MAX} px-8 py-24 md:py-32`}
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
