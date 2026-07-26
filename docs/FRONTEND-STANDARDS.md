# Chronicle — Frontend Execution Standards

Binding for all frontend surfaces (`/`, `/app`, `/eval`). Overrides default agent behavior and Magic MCP generation defaults.

This file is read at the start of every frontend session cycle.

---

## H.1 — Aesthetic direction (locked)

Reference targets (caliber): Linear, Vercel, Things 3, Anthropic homepage. Restraint with visual presence — minimal but not empty.

**Anti-references (forbidden):**
- Consumer healthtech: bright blue, friendly gradients, illustrations of doctors / patients / hospitals / pills / stethoscopes
- SaaS marketing: purple-to-blue gradients, glassmorphism, particle effects, animated gradient backgrounds
- Startup landing tropes: testimonials, pricing tables, logo bars, FAQ sections, team grids, newsletter signup

**Tone: "calm clinical."** A tool a careful doctor would use, not a consumer app. When agents face tension between "make this more impressive" and "keep this calm clinical," calm clinical wins.

### Locked design tokens

Do not deviate. Do not let Magic-generated components override.

| Role | Token | Hex |
|---|---|---|
| Background base | `bg-base` | `#FAFAF7` (off-white) |
| Surface | `bg-surface` | `#FFFFFF` |
| Background warm | `bg-base-warm` | `#F5F5F0` (alternating landing sections) |
| Border | `border-default` | `#E5E5E0` |
| Text primary | `text-primary` | `#0A0A0A` |
| Text secondary | `text-secondary` | `#54544F` |
| Text tertiary | `text-tertiary` | `#70706B` |
| Accent (CTAs only, sparingly) | `accent` | `#0F766E` (teal) |
| Severity — info | `sev-info` | `#6B7280` (slate) |
| Severity — monitor | `sev-monitor` | `#D97706` (amber) |
| Severity — concerning | `sev-concerning` | `#DC2626` (red) |
| Severity — urgent | `sev-urgent` | `#991B1B` (dark red) |
| Source-snippet highlight | `snippet-highlight` | `#FEF08A` at 60% opacity |

**The ink scale is WCAG AA-gated on all three backgrounds.** `text-secondary` and `text-tertiary` carry 9-12px micro-labels, so the bar is AA for normal text (**4.5:1**), not AA-large. Measured on `#FAFAF7` / `#FFFFFF` / `#F5F5F0` by `npx tsx scripts/check-contrast.ts` — run it after any change to these three, it exits non-zero on a regression: primary **18.93 / 19.80 / 18.10**, secondary **7.28 / 7.61 / 6.96**, tertiary **4.76 / 4.98 / 4.55**. The previous values were `#6B6B6B` (5.10 / 5.33 / 4.87) and `#9A9A95` (**2.70 / 2.83 / 2.58 — failed AA** across 86 usage sites in 8 components). Secondary moved even though it already passed: with tertiary raised it would have sat beside secondary's 5.10, leaving the two tiers visually indistinguishable and collapsing the three-step hierarchy into two. Note the hue — `#6B6B6B` was **neutral** (R=G=B) and only `#9A9A95` carried the `B = R−5` warm cast; `#54544F` **adopts** that cast for scale consistency with the warm base. Do not lower the threshold to make a lighter grey fit.

**Why the third background is a token.** `#F5F5F0` was hard-coded in `app/page.tsx` when the gate was written, so the gate — which only reads `--color-*` tokens out of `app/globals.css` — could not see it. Tertiary at the interim `#71716C` cleared base and surface (4.691 / 4.906) but sat at **4.486 on `#F5F5F0`**, an AA failure on the six 11px labels painted directly on the Section 3 background — which the gate reported as all-clear. It is now `--color-base-warm` and gated. **Any new page background must be added as a token *and* to `BACKGROUND_TOKENS` in the script** — a background the gate cannot parse is a background it silently exempts.

**`#70706B` is the floor of the ink scale.** Do not darken `text-tertiary` further without re-spacing `text-secondary` too: the secondary→tertiary step is now the tightest in the scale at **ΔL\* 11.52** (was 18.24 with `#6B6B6B`/`#9A9A95`, a 36.8% compression), and it is the step that carries the content-vs-metadata distinction. Known accepted consequence: at L\* 47.10 tertiary now sits **0.81 ΔL\*** from `sev-info` `#6B7280` (L\* 47.90), where it used to be 15.56 apart. That collision is confined to three *mock* labels on the landing page — the two `info` labels in the hero scroll board plus `VISIT` in the section mock — and real event cards paint severity as a left-rail background, never as text (`components/event-card.tsx`). It is a **lightness/hierarchy** concern, **not a contrast one**: `sev-info`-as-text measures **4.834:1** on the landing, which passes AA. The severity palette is locked (§H.1 / RESOLVED-DECISIONS #3), so it is accepted rather than fixed.

**Severity tokens supersede RESOLVED-DECISIONS.md #3.** The earlier stone-400 / amber-400 / orange-600 / red-600 palette is no longer current. The H10 colorblind sim check from RESOLVED-DECISIONS.md #3 still applies but to the new palette — specifically, verify that concerning `#DC2626` and urgent `#991B1B` (both reds) remain distinguishable under deuteranopia and protanopia. If they don't, **adjust the urgent token only** (e.g., `#7F1D1D` for more lightness gap). Do not touch the other three.

### Typography

- **Inter** for everything (body, UI, buttons)
- **"Chronicle" wordmark in Source Serif Pro at 22px** (the only serif use anywhere)
- No other fonts
- Consequence: `--font-mono` in `app/globals.css` is deliberately mapped to the sans face, because there is no mono face in this system. `font-mono` utilities (used on micro-labels for tabular rhythm) therefore render Inter. Do not repoint it at a mono family without reopening this lock.

### Visual texture (allowed only these)

- Faint dot grid in landing hero: 1px dots, `#E5E5E0`, 24px spacing, radial-mask fade at edges
- Soft horizontal gradient dividers between landing sections
- Subtle teal radial glow under landing hero product preview

---

## H.2 — Tooling strategy (locked)

### Component sourcing order

1. **Magic MCP (`/ui` command)** is the first stop for any new section or non-trivial component. Generated components MUST be adapted to the locked design tokens before merging — strip any colors, fonts, or effects not in the token list.
2. **shadcn/ui primitives** for atomic elements (Button, Card, Sheet, Dialog).
3. **Hand-written** only when (1) and (2) don't fit.

### Documentation-first for non-trivial APIs

**Context7 MCP** is the source of truth for `framer-motion`, `shadcn/ui`, Tailwind, Next.js App Router, and `lucide-react` APIs. Agents must consult Context7 before writing non-trivial framer-motion or shadcn code; do not rely on training-data API memory.

### Magic MCP usage rules

- One `/ui` call per section maximum. If the first generation is wrong aesthetic, re-prompt with stricter constraints; do not iterate beyond two attempts per section.
- Every Magic-generated component is reviewed against locked tokens before merging. Common adaptations:
  - Replace gradient backgrounds with solid tokens
  - Replace purple/blue accents with `accent` (teal-700)
  - Replace serif/display fonts with Inter
  - Remove glassmorphism
- **Generations are metered. Budget: 10 ceiling, 8 soft target across the whole build.** One re-prompt headroom for two sections that come out wrong.

---

## H.3 — Animation budget (locked)

### Reduced-motion respect (mandatory)

All framer-motion animations must be wrapped in `useReducedMotion()` check. If `prefers-reduced-motion` is set, **skip entrance animations and the loop pulse**. Hover states remain (they're discrete user-initiated interactions, not autonomous motion).

```tsx
const shouldReduceMotion = useReducedMotion();
const initial = shouldReduceMotion ? false : { opacity: 0, y: 20 };
const animate = shouldReduceMotion ? false : { opacity: 1, y: 0 };
```

### Permitted motion

#### 1. Scroll-triggered entrance (one-shot per element)

- Trigger: framer-motion `whileInView` with `viewport={{ once: true, margin: "-100px" }}`
- Initial: `{ opacity: 0, y: 20 }` → animate to `{ opacity: 1, y: 0 }`
- Duration 600ms, easing `cubic-bezier(0.16, 1, 0.3, 1)`
- Stagger sibling elements by 100ms

#### 2. Hero initial-load cascade (page mount, landing only)

- Headline: immediate
- Subhead: +150ms
- CTA: +300ms
- Product preview: +500ms with 800ms duration

#### 3. ONE looping animation, scoped to the landing hero product preview only

- Yellow source-snippet highlight pulses: fade 0 → 60% opacity over 1.5s, hold 2s, fade out 1s, pause 0.5s, repeat infinitely
- Implemented as a **positioned absolute CSS overlay on top of the static hero screenshot**, NOT as a re-rendered live component
- This is the only continuous animation on any surface

#### 4. Hover states on interactive elements

- Buttons: subtle background-color shift, 150ms ease-out
- Cards: shadow grows softly, border darkens slightly, card lifts 1px (CSS `translateY(-1px)` only, no transform-scale)
- No transform-scale, no rotation, no gradient shifts

### Forbidden motion

- Scroll-triggered parallax / rotation
- Autoplaying carousels / marquees / video
- Continuous gradient animation
- Spring physics on entrance (use the cubic-bezier easing above)
- Motion that draws attention without conveying information

---

# I. Landing page spec (`/`)

Public landing page at root. Five vertically stacked sections, scrollable, single page. Routes to `/app` via Get Started CTA. Aesthetic, tokens, and animation governed by Section H above.

The landing page exists for non-demo audiences: Devpost screenshots, judges revisiting the table, post-event portfolio. **Demo flow opens on `/app`, not `/`.**

## Section 1 — Hero (full viewport)

- **Top nav:** "Chronicle" wordmark (Source Serif Pro, 22px, `text-primary`) on the left. Nothing on the right.
- **Centered headline** (Display 64px Bold `text-primary`):
  > Your medical records, on one timeline.
- **Subhead** (Body Large 22px Regular `text-secondary`):
  > Patients have 30 documents from 5 doctors. Chronicle ties them together.
- **Primary CTA:** "Get started" (`accent` background, white text, 14px vertical / 32px horizontal padding, 8px radius). Routes to `/app` via `next/link`.
- **Below CTA:** dominant product preview, ~1100px wide.
  - **Real screenshot of `/app`** with Sarah Chen loaded + side panel open + snippet highlighted, captured at H10/H11 polish.
  - **Until that screenshot exists**, use a placeholder `placeholder-hero.png` (any 16:10 light-toned image of similar dimensions). Mark with a TODO comment.
  - Soft teal-tinted radial glow underneath (large blurred circle at low opacity).
  - Layered shadow: `0 10px 40px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)`.
  - **Yellow source-snippet highlight pulses on the loop spec'd in H.3** — implement as a positioned absolute CSS overlay on top of the screenshot, NOT as a re-rendered live component.
- **Background:** `bg-base` with the dot-grid texture from H.1.

## Section 2 — Problem framing

- **Heading:** "Your records are everywhere." (H1 44px Bold)
- **Three stat cards horizontally:**
  - **30+** — "documents per patient with a chronic condition"
  - **5** — "different healthcare providers"
  - **0** — "places that tie them together"
  - Big number in `accent` (teal-700), label below in `text-secondary`
- **Caption below cards** (Body 16px Regular `text-secondary`):
  > Patients managing chronic conditions often have 30+ documents from multiple providers. Chronicle ties them together.
- **Background:** `bg-surface` (`#FFFFFF`).

## Section 3 — How it works

- **Heading:** "Three steps." (H1 44px Bold)
- **Three columns:** Drop / Read / See
- **Each column:**
  - lucide line icon (48px, `accent` teal)
  - Heading (H3 24px Semibold)
  - 2-3 line description (Body 16px Regular `text-secondary`)
- **Suggested icons:**
  - Drop: `Upload` or `FileUp`
  - Read: `ScanText` or `Eye`
  - See: `LineChart` or `Clock`
- **Background:** `bg-base-warm` / `var(--color-base-warm)` = `#F5F5F0` (slightly darker off-white for rhythm). Use the token, never the literal — a hard-coded hex is invisible to the contrast gate.

## Section 4 — Trust

- **Two-column layout.**
- **Left:**
  - Eyebrow "TRACEABLE" (12px Medium Uppercase `accent` teal, letter-spacing 1.5px)
  - Heading "Every claim, traceable." (H2 32px Bold)
  - Body explaining verbatim source attribution (Body 16px Regular `text-secondary`)
- **Right:**
  - Large mockup of the click-source side panel
  - Paper-textured PDF page (subtle horizontal text-row simulation)
  - Yellow-highlighted snippet (`snippet-highlight` token, `#FEF08A` at 60% opacity)
  - Below the PDF mock: an expanded "What does this mean?" card with two lines of placeholder patient-friendly text
- **Background:** `bg-surface` (`#FFFFFF`).

## Section 5 — Final CTA + footer

- **Heading:** "See your records in a new light." (H1 44px Bold)
- **Primary CTA "Get started"** (routes to `/app`).
- **Footer** (thin top border `border-default`, 60px tall):
  > Built at HackDavis 2026 · Murat Alkan · github.com/muratalkan06
- Footer text: Body Small 14px `text-secondary`, centered.
- **Background:** `bg-base`.

## Out of scope for landing

Testimonials, pricing, FAQ, team section, logo bar, animated gradient backgrounds, glassmorphism, scroll-triggered choreography or parallax, autoplaying video, illustrations of doctors / patients / hospitals.
