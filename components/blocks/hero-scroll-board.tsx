/**
 * Scroll-reveal "clinician whiteboard" block.
 *
 * Adapted from the 21st.dev "Container Scroll Animation" primitive: the
 * inner panel starts pill-shaped and inset, then expands to full-width with
 * rounded corners as the user scrolls. The original demo holds an iPad-style
 * video. Here the inset holds a stylized clinician whiteboard — handdrawn-feel
 * patient timeline with sticky notes and pinned PDF thumbnails.
 *
 * All motion respects useReducedMotion: the scroll-driven inset/translate is
 * suppressed and the panel renders fully unfurled.
 */
"use client";

import * as React from "react";
import {
  motion,
  useMotionTemplate,
  useReducedMotion,
  useScroll,
  useTransform,
  type HTMLMotionProps,
  type MotionValue,
} from "framer-motion";

// ---------------------------------------------------------------------------
// Primitives — ContainerScroll / Stagger / Animated / Inset
// (Lean adaptation of 21st.dev's component to framer-motion + locked tokens.)
// ---------------------------------------------------------------------------

interface ContainerScrollValue {
  scrollYProgress: MotionValue<number>;
  reduce: boolean;
}

const ContainerScrollContext = React.createContext<
  ContainerScrollValue | undefined
>(undefined);

function useContainerScrollContext() {
  const ctx = React.useContext(ContainerScrollContext);
  if (!ctx) {
    throw new Error(
      "ContainerScroll subcomponent used outside <ContainerScroll>",
    );
  }
  return ctx;
}

function ContainerScroll({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() ?? false;
  // progress=0 when section top reaches 70% down the viewport (section is
  // mostly in view, headline already read); progress=1 when section bottom
  // reaches 70% down. The wipe runs over a tight scroll band so the panel
  // is fully revealed while centered on screen, not after.
  const { scrollYProgress } = useScroll({
    target: scrollRef,
    offset: ["start 0.7", "end 0.7"],
  });

  return (
    <ContainerScrollContext.Provider value={{ scrollYProgress, reduce }}>
      <section
        className={cx("relative w-full py-16 md:py-24", className)}
        ref={scrollRef}
        {...props}
      >
        {children}
      </section>
    </ContainerScrollContext.Provider>
  );
}

type AnimateT = "top" | "bottom" | "left" | "right" | "blur" | "z" | undefined;

function ContainerStagger({
  children,
  className,
  ...props
}: HTMLMotionProps<"div">) {
  const { reduce } = useContainerScrollContext();
  if (reduce) {
    return (
      <div className={cx("relative", className)}>
        {children as React.ReactNode}
      </div>
    );
  }
  return (
    <motion.div
      className={cx("relative", className)}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      transition={{ staggerChildren: 0.18 }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

interface ContainerAnimatedProps extends HTMLMotionProps<"div"> {
  animation?: AnimateT;
}

function ContainerAnimated({
  animation,
  children,
  className,
  ...props
}: ContainerAnimatedProps) {
  const { reduce } = useContainerScrollContext();
  const variants = React.useMemo(
    () => ({
      hidden: {
        x: animation === "left" ? "-30%" : animation === "right" ? "30%" : 0,
        y: animation === "top" ? "-40%" : animation === "bottom" ? "40%" : 0,
        scale: animation === "z" ? 0.92 : 1,
        filter: animation === "blur" ? "blur(8px)" : "blur(0px)",
        opacity: 0,
      },
      visible: {
        x: 0,
        y: 0,
        scale: 1,
        filter: "blur(0px)",
        opacity: 1,
      },
    }),
    [animation],
  );

  if (reduce)
    return <div className={className}>{children as React.ReactNode}</div>;

  return (
    <motion.div
      transition={{
        type: "spring",
        stiffness: 100,
        damping: 18,
        mass: 0.75,
      }}
      variants={variants}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

interface ContainerInsetProps extends HTMLMotionProps<"div"> {
  translateYRange?: [string, string];
  insetRightRange?: [number, number];
}

/**
 * Scroll-driven reveal — left-to-right wipe. The board's right edge is
 * clipped 100% at the start (panel completely hidden) and unclips to 0% as
 * the user scrolls, exposing content from left to right like a wipe edit.
 * Corners stay 16px throughout. No circle phase, no curtain split.
 */
function ContainerInset({
  translateYRange = ["-6%", "0%"],
  insetRightRange = [100, 0],
  children,
  className,
  style,
  ...props
}: ContainerInsetProps) {
  const { scrollYProgress, reduce } = useContainerScrollContext();
  const y = useTransform(scrollYProgress, [0, 1], translateYRange);
  // Compress the wipe into the first 55% of the scroll band so the panel
  // settles fully revealed well before the user scrolls past the section.
  const insetRight = useTransform(
    scrollYProgress,
    [0, 0.55],
    insetRightRange,
  );
  const clipPath = useMotionTemplate`inset(0% ${insetRight}% 0% 0% round 16px)`;

  if (reduce) {
    return (
      <div
        className={cx(
          "origin-top overflow-hidden rounded-[16px] border border-line",
          className,
        )}
        style={style as React.CSSProperties | undefined}
      >
        {children as React.ReactNode}
      </div>
    );
  }

  return (
    <motion.div
      className={cx(
        "origin-top overflow-hidden border border-line shadow-[0_24px_60px_-24px_rgba(15,23,42,0.18),0_2px_8px_rgba(15,23,42,0.04)]",
        className,
      )}
      style={{ y, clipPath, borderRadius: 16, ...style }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Public block — composed scroll-reveal whiteboard
// ---------------------------------------------------------------------------

export function HeroScrollBoard() {
  return (
    <ContainerScroll className="bg-base text-ink">
      <ContainerStagger className="mx-auto max-w-[900px] px-8 text-center">
        <ContainerAnimated animation="top">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink-subtle">
            The view a clinician would draw
          </p>
        </ContainerAnimated>
        <ContainerAnimated animation="top">
          <h2 className="mt-5 text-[clamp(32px,4vw,56px)] font-semibold leading-[1.04] tracking-[-0.03em] text-ink">
            Without the marker.
          </h2>
        </ContainerAnimated>
        <ContainerAnimated animation="blur" className="mx-auto mt-5 max-w-[52ch]">
          <p className="text-[15px] leading-relaxed text-ink-muted">
            Doctors stitch a patient&apos;s history together by hand — sticky
            notes, handwritten arrows, hunting for the right PDF. Chronicle does
            that stitch on screen, in seconds, with citations.
          </p>
        </ContainerAnimated>
      </ContainerStagger>

      <div className="mx-auto mt-12 max-w-[1040px] px-6">
        <ContainerInset>
          <ClinicalWhiteboard />
        </ContainerInset>
      </div>
    </ContainerScroll>
  );
}

// ---------------------------------------------------------------------------
// The whiteboard itself — stylized handdrawn patient timeline
// ---------------------------------------------------------------------------

function ClinicalWhiteboard() {
  return (
    <div
      className="relative aspect-[16/10] w-full overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, #FBFBF7 0%, #F5F5F0 100%)",
      }}
    >
      {/* Faint grid texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(#E5E5E0 1px, transparent 1px), linear-gradient(90deg, #E5E5E0 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Header — patient + dates window */}
      <div className="absolute left-8 right-8 top-6 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.2em] text-ink-subtle">
        <span>Patient · Sarah Chen, 47F</span>
        <span>Jan &apos;23 → Jul &apos;24</span>
      </div>
      <div
        aria-hidden
        className="absolute left-8 right-8 top-12 h-px bg-ink/20"
      />

      {/* Hand-scrawled big title — moved to bottom-left corner so it doesn't
          collide with the sticky-note zone. Cross-fades to plain language
          partway through the wipe. */}
      <CrossFadeText
        clinical="T2D progression — 18 months"
        plain="Diabetes journey — 18 months"
        className="absolute bottom-8 left-8 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink"
        style={{ transform: "rotate(-1.2deg)" }}
      />

      {/* Timeline axis (SVG) */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1000 625"
        preserveAspectRatio="none"
        aria-hidden
      >
        {/* Hand-jittered horizontal axis */}
        <path
          d="M 80 360 Q 260 354 460 364 T 920 358"
          stroke="#0A0A0A"
          strokeOpacity="0.45"
          strokeWidth="1.4"
          fill="none"
        />
        {/* Date nodes */}
        {[
          { x: 130, y: 360 },
          { x: 290, y: 358 },
          { x: 450, y: 364 },
          { x: 600, y: 360 },
          { x: 760, y: 360 },
          { x: 900, y: 358 },
        ].map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="5"
            fill="#FAFAF7"
            stroke="#0A0A0A"
            strokeOpacity="0.55"
            strokeWidth="1.4"
          />
        ))}
        {/* Hand-drawn connector arrow from sticky to a node */}
        <path
          d="M 220 220 C 240 280 240 310 290 350"
          stroke="#0F766E"
          strokeOpacity="0.7"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 286 348 L 295 358 L 282 358 Z"
          fill="#0F766E"
          fillOpacity="0.7"
        />
        {/* arrow from amber sticky to node */}
        <path
          d="M 720 200 C 700 260 690 300 760 350"
          stroke="#D97706"
          strokeOpacity="0.7"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 756 348 L 765 358 L 752 358 Z"
          fill="#D97706"
          fillOpacity="0.75"
        />
        {/* arrow from PDF thumb to node */}
        <path
          d="M 460 470 C 460 430 450 400 450 380"
          stroke="#0A0A0A"
          strokeOpacity="0.35"
          strokeWidth="1.4"
          fill="none"
          strokeDasharray="4 5"
          strokeLinecap="round"
        />
      </svg>

      {/* Date labels under the axis */}
      {[
        { left: "12.5%", text: "Jan '23" },
        { left: "28.5%", text: "Apr '23" },
        { left: "44.5%", text: "Jul '23" },
        { left: "59.5%", text: "Nov '23" },
        { left: "75.5%", text: "Mar '24" },
        { left: "89%", text: "Jul '24" },
      ].map((d) => (
        <span
          key={d.text}
          className="absolute font-mono text-[11px] tracking-wider text-ink-subtle"
          style={{ left: d.left, top: "62%", transform: "translateX(-50%)" }}
        >
          {d.text}
        </span>
      ))}

      {/* Sticky note: teal — "metformin start" */}
      <Sticky
        className="left-[12%] top-[20%]"
        rotate={-3.5}
        tone="teal"
        eyebrow="Levy, MD"
        eyebrowPlain="Dr. Levy"
        body={"start metformin\n500 mg b.i.d."}
        bodyPlain={"started a daily\ndiabetes pill"}
      />

      {/* Sticky note: amber — "A1c ↑↑" */}
      <Sticky
        className="left-[64%] top-[18%]"
        rotate={2.4}
        tone="amber"
        eyebrow="Park, MD"
        eyebrowPlain="Dr. Park"
        body={"A1c trending\n↑↑ — escalate?"}
        bodyPlain={"blood sugar\ngetting worse"}
      />

      {/* Pinned PDF thumbnails — kept inside right edge, above the bottom
          title/annotation row so nothing collides. */}
      <PinnedDoc
        className="left-[34%] top-[68%]"
        rotate={-2.2}
        label="d2_pcp_2023_04.pdf"
      />
      <PinnedDoc
        className="left-[68%] top-[68%]"
        rotate={1.4}
        label="d5_endo_2024_03.pdf"
      />

      {/* Annotation — bottom right, clear of the title in the bottom-left. */}
      <CrossFadeText
        clinical="7 documents · 3 providers · 18 events"
        plain="7 reports · 3 doctors · 18 events"
        className="absolute right-8 bottom-8 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-subtle"
      />
    </div>
  );
}

interface StickyProps {
  className?: string;
  rotate?: number;
  tone: "teal" | "amber" | "ink";
  eyebrow?: string;
  eyebrowPlain?: string;
  body: string;
  bodyPlain?: string;
  size?: "sm" | "md";
}

function Sticky({
  className,
  rotate = 0,
  tone,
  eyebrow,
  eyebrowPlain,
  body,
  bodyPlain,
  size = "md",
}: StickyProps) {
  const palette = {
    teal: { bg: "rgba(15,118,110,0.10)", border: "rgba(15,118,110,0.4)" },
    amber: { bg: "rgba(217,119,6,0.10)", border: "rgba(217,119,6,0.4)" },
    ink: { bg: "rgba(10,10,10,0.04)", border: "rgba(10,10,10,0.18)" },
  }[tone];

  return (
    <div
      className={cx(
        "absolute rounded-sm border bg-surface px-3 py-2 shadow-[0_4px_10px_-4px_rgba(15,23,42,0.18)]",
        size === "sm" ? "max-w-[120px]" : "max-w-[160px]",
        className,
      )}
      style={{
        transform: `rotate(${rotate}deg)`,
        backgroundColor: palette.bg,
        borderColor: palette.border,
      }}
    >
      {eyebrow ? (
        <CrossFadeText
          as="p"
          clinical={eyebrow}
          plain={eyebrowPlain ?? eyebrow}
          className="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-subtle"
        />
      ) : null}
      <CrossFadeText
        as="p"
        clinical={body}
        plain={bodyPlain ?? body}
        className="mt-1 whitespace-pre-line text-[12.5px] leading-snug text-ink"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrossFadeText — swaps clinical → plain text as the scroll wipe progresses.
// Both versions are rendered in a relative wrapper; the clinical layer fades
// out and the plain layer fades in across [0.55, 0.78] of scrollYProgress so
// the swap lands midway through the reveal. Reduced-motion users see only the
// clinical (source-of-truth) version.
// ---------------------------------------------------------------------------

interface CrossFadeTextProps {
  clinical: string;
  plain: string;
  className?: string;
  style?: React.CSSProperties;
  as?: "p" | "div" | "span";
}

function CrossFadeText({
  clinical,
  plain,
  className,
  style,
  as = "div",
}: CrossFadeTextProps) {
  const { scrollYProgress, reduce } = useContainerScrollContext();
  const clinicalOpacity = useTransform(scrollYProgress, [0.55, 0.78], [1, 0]);
  const plainOpacity = useTransform(scrollYProgress, [0.55, 0.78], [0, 1]);

  // No swap when reduced-motion or when the two strings are identical.
  if (reduce || clinical === plain) {
    return React.createElement(
      as,
      { className, style },
      clinical,
    );
  }

  return (
    <span
      className={cx("relative inline-block", className)}
      style={style}
    >
      {/* Plain — sits below, fades in. Determines the wrapper's box size so
          the clinical layer can absolute-position over it cleanly. */}
      <motion.span
        style={{ opacity: plainOpacity }}
        className="block whitespace-pre-line"
      >
        {plain}
      </motion.span>
      {/* Clinical — overlays, fades out. */}
      <motion.span
        style={{ opacity: clinicalOpacity }}
        className="absolute inset-0 block whitespace-pre-line"
      >
        {clinical}
      </motion.span>
    </span>
  );
}

function PinnedDoc({
  className,
  rotate = 0,
  label,
}: {
  className?: string;
  rotate?: number;
  label: string;
}) {
  return (
    <div
      className={cx("absolute", className)}
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      {/* pin */}
      <span
        aria-hidden
        className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1 rounded-full bg-sev-concerning shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
      />
      <div className="w-[120px] rounded-sm border border-line bg-surface p-2 shadow-[0_4px_10px_-4px_rgba(15,23,42,0.20)]">
        <div className="space-y-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[3px] rounded-sm bg-line/70" />
          ))}
        </div>
        <p className="mt-2 truncate font-mono text-[9px] tracking-wider text-ink-subtle">
          {label}
        </p>
      </div>
    </div>
  );
}

function cx(...parts: Array<string | undefined | false | null>) {
  return parts.filter(Boolean).join(" ");
}
