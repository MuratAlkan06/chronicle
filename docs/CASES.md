# Chronicle — Patient Cases & PDF Authoring Guide

Spec for the 3 sample patient cases. The PDFs are authored by hand (Word → export PDF is fine) and live under `data/cases/<case_id>/docs/` for Cases 1+2 and `held_out/case3/docs/` for Case 3.

**Hard ordering rule (held-out hygiene):** Case 3 PDFs and ground-truth labels are written FIRST and locked before any work on Cases 1+2. This prevents backward-tuning the held-out case to extraction patterns observed in the others. Per BUILD.md Block 1.

---

## Per-PDF authoring requirements (apply to ALL cases per Q22)

Each PDF must contain:

### 1. ≥ 2 medical abbreviations used naturally in clinical prose

Drawn from this set (use these or equivalents):

| Abbrev | Meaning |
|---|---|
| `pt` | patient |
| `c/o` | complains of |
| `Hx`, `PMH` | history, past medical history |
| `s/p` | status post (after) |
| `r/o` | rule out |
| `f/u` | follow-up |
| `Δ` | change |
| `LBP`, `T2D`, `HTN`, `HLD` | low back pain, type 2 diabetes, hypertension, hyperlipidemia |
| `A1c` (or `HbA1c`) | glycated hemoglobin |
| `BMI`, `BP`, `HR`, `RR` | body mass index, blood pressure, heart rate, respiratory rate |
| `q.d.`, `b.i.d.`, `t.i.d.`, `p.r.n.` | once daily, twice daily, three times daily, as needed |
| `BI-RADS` | breast imaging reporting and data system (1-6 score) |
| `MRI`, `CT`, `XR`, `US` | imaging modalities |

### 2. ≥ 1 date format inconsistency

Mix at least two of:
- `MM/DD/YYYY` (e.g., `03/15/2024`)
- `DD-MMM-YYYY` (e.g., `15-Mar-2024`)
- Long form (e.g., `March 15, 2024`)
- Partial date — month + year only (e.g., `March 2024`) — should trigger `date_confidence: approximate` in extraction
- Relative date inside a dated note (e.g., a note dated 04/01/2024 saying "two weeks ago she began...") — should trigger `date_confidence: inferred`

### 3. ≥ 1 cross-document contradiction within the case

Subtle, plausible, not bizarre. Examples per case in the case sections below. Tests whether the model surfaces the conflict (two events linked via `related_ids` per Q16) rather than silently picking one.

### 4. Realism

If the PDFs read as bullet-pointed structured notes, the demo will look hollow ("toy data") and a judge familiar with real EHR notes will dismiss the credibility moat. Push toward realistic clinical prose:
- Headers/footers (clinic name, address, fax line, page numbers)
- Provider signature blocks ("Sarah Levy, MD" or similar)
- Mixed paragraph + tabular sections (labs in tables, narrative in paragraphs)
- Occasional typos or imprecise language
- Boilerplate filler ("Seen in clinic today is the above-named patient who presents for...")
- 1-3 pages per doc — short enough to read end-to-end during PDF auth, long enough to look real

Goal: a judge with EHR experience should think "yeah, this looks like the messy stuff I've seen."

### File naming convention

`d{N}_{type}_{YYYY_MM}.pdf` — e.g., `d1_pcp_2024_01.pdf`, `d4_mri_2024_03.pdf`. The `d{N}` prefix gives stable doc IDs for the schema's `source.document_id` field. Use month resolution in the filename even if the document itself has a specific day.

---

## Case 1: Sarah Chen, 47F — Type 2 Diabetes progression

**Files:** `data/cases/case1/docs/`
**Doc count:** 7 PDFs over 18 months
**Expected event count after extraction:** ~15-25 (7 docs × 2-4 events per doc on average)

**Narrative arc:** Initial T2D diagnosis at PCP visit → metformin started → 3-month A1c not at goal → metformin dose increased → A1c improving over next 6 months → routine follow-up → annual labs.

**Document mix (suggested):**

| # | Doc type | Approx date | Events likely |
|---|---|---|---|
| d1 | PCP visit + initial A1c lab | 2023-01 | visit, lab (A1c 9.2%), diagnosis (T2D added), medication (metformin 500mg b.i.d. started) — 4 events |
| d2 | Lab-only doc: 3-month A1c follow-up | 2023-04 | lab (A1c 8.4%) — 1 event |
| d3 | PCP visit: A1c discussion + metformin dose increase | 2023-05 | visit, medication (metformin → 1000mg b.i.d.) — 2 events |
| d4 | Lab-only doc: 6-month A1c follow-up | 2023-08 | lab (A1c 7.2%) — 1 event |
| d5 | PCP visit: stable A1c + lifestyle counseling | 2023-11 | visit — 1 event |
| d6 | Lab-only doc: annual A1c + lipid panel | 2024-04 | 2 lab events (A1c, lipid panel) |
| d7 | PCP annual physical visit | 2024-07 | visit — 1 event |

**Cross-doc contradiction example:** d3 records "metformin 1000mg b.i.d." but d5 references "metformin 850mg b.i.d." (real-world this happens — provider transcription error or dose tweak that wasn't documented as a separate change). Surfaces as two `medication` events with different doses; ideal extraction links them via `related_ids`.

**Test focus:**
- Longitudinal lab values trending (A1c going down over time should be visible chronologically)
- Same diagnosis (T2D) appearing in problem list across multiple visits — model must NOT emit a new `diagnosis` event each time (per system prompt rule "no `continues` or `no change` mentions of prior events")
- Medication dose-changes (3 distinct medication events: started, increased, contradicted)

---

## Case 2: Maria Rodriguez, 52F — Suspicious mammogram → benign biopsy

**Files:** `data/cases/case2/docs/`
**Doc count:** 6 PDFs over 3 months
**Expected event count after extraction:** ~10-15

**Narrative arc:** Routine OB/GYN visit → screening mammogram ordered → BI-RADS 4 finding (suspicious) → referral to breast surgery → biopsy procedure → benign result → reassurance follow-up.

**Document mix (suggested):**

| # | Doc type | Approx date | Events likely |
|---|---|---|---|
| d1 | OB/GYN annual visit | 2024-02 | visit, referral (to imaging for screening mammo) — 2 events |
| d2 | Mammogram report | 2024-02 | imaging (BI-RADS 4 — suspicious) — 1 event, severity = `concerning` |
| d3 | Referral letter to breast surgery | 2024-03 | referral — 1 event |
| d4 | Breast surgery consult note | 2024-03 | visit, procedure (biopsy scheduled) — 2 events |
| d5 | Biopsy procedure report | 2024-04 | procedure (biopsy performed + benign result) — 1 event, severity de-escalates to `monitor` or `info` |
| d6 | OB/GYN follow-up: benign result discussion | 2024-05 | visit — 1 event, severity = `info` (reassurance) |

**Cross-doc contradiction example:** d2 mammogram says "right breast 11 o'clock position"; d5 biopsy report says "right breast upper outer quadrant" — these are roughly the same area but transcribed differently across reads. Or: d4 surgical consult states "biopsy scheduled for next week"; d5 dated 9 days later — small but notable timing.

**Test focus:**
- The procedure-vs-imaging distinction (biopsy ≠ mammogram even though both are in the breast). This is the single most important schema-disambiguation in the case.
- Severity escalation/de-escalation across the chain: `concerning` (suspicious mammo) → still `concerning` (biopsy scheduled) → `monitor` or `info` (benign result) → `info` (reassurance follow-up). The timeline should visually walk the audience through the resolution.
- Referral as its own event distinct from the visit that ordered it.

**This case is the source of Few-shot 2 in the extraction prompt — it must include a clear biopsy-as-procedure event for the few-shot to demonstrate the imaging-vs-procedure distinction (per resolved decision #4, 7/7 type coverage).**

---

## Case 3: David Park, 38M — Chronic low back pain across 5 providers (HELD-OUT)

**Files:** `held_out/case3/docs/`
**Doc count:** 8 PDFs over 6 months
**Expected event count after extraction:** ~15-30 (per EVAL.md quality checklist range)

**Narrative arc:** PCP for back pain → ortho referral → MRI → ortho consult → PT trial → pain mgmt referral → pain mgmt consult → PCP re-presentation (symptoms persist).

**HELD-OUT DISCIPLINE — read EVAL.md before opening:**
- Write these PDFs FIRST, before Cases 1+2.
- Write the ground-truth labels in the SAME sitting (see EVAL.md "step-by-step for Murat — writing Case 3 ground-truth labels"). Read the protocol before you start.
- After writing labels: hash-lock + chmod 444 + commit (3 commands; EVAL.md quality checklist).
- Do NOT open these PDFs again until H11.
- The extraction prompt MUST NOT use Case 3 in any few-shot.
- The Case 3 extraction script (`scripts/eval-case3.ts`) is committed at H0 and never edited.

**Document mix (suggested):**

| # | Doc type | Approx date | Events likely |
|---|---|---|---|
| d1 | PCP initial visit for LBP | 2024-01 | visit, diagnosis (LBP added to problem list) — 2 events |
| d2 | Ortho referral letter | 2024-01 | referral — 1 event |
| d3 | Ortho consult note | 2024-02 | visit, referral (MRI ordered) — 2 events |
| d4 | MRI lumbar spine report | 2024-03 | imaging — 1 event |
| d5 | PT initial evaluation note | 2024-03 | visit — 1 event |
| d6 | PT re-evaluation + pain mgmt referral | 2024-04 | visit, referral — 2 events |
| d7 | Pain management consult | 2024-05 | visit, medication (gabapentin started) — 2 events |
| d8 | PCP follow-up — symptoms persisting | 2024-06 | visit — 1 event |

**Cross-doc contradiction example:**
- d4 (MRI) reports "L4-L5 disc bulge"; d3 (ortho consult, written before the MRI) references "concerns for L5-S1 pathology" — the ortho's clinical suspicion was at a different level than the imaging confirmed. Plausible real-world divergence.
- OR: d2 referral letter says "patient reports 6 weeks of pain"; d3 ortho consult dated 2 weeks later says "patient reports 3 months of pain" — patient self-reports drift.

**Test focus:**
- Multi-provider continuity (5 different providers: PCP, ortho, radiologist, PT, pain mgmt). Model needs to surface that this is the same patient across all of them.
- Referral chains (PCP→ortho, ortho→PT, PT→pain mgmt). Each referral is its own event.
- Ambiguous severity — chronic LBP is rarely "urgent" but the patient's quality-of-life impact may push it past `info`. Exercise the prompt's "err toward `monitor`, not `urgent`" guidance.
- Medication start (d7 gabapentin) without an obvious dramatic trigger — model needs to pick the right severity level.

---

## Sanity-check questions before locking each case

For each case after writing the PDFs (and BEFORE writing ground truth for Case 3):

1. Could a doctor read these in 5 minutes and form a coherent picture of the patient? (Coherence test.)
2. Is at least one document doing double-duty (multiple event types in one PDF)? (Tests the multi-event extraction pattern.)
3. Are dates spread realistically (not clustered too tight, not implausibly spaced)?
4. Is the contradiction plausible (a real provider could plausibly have written both)?
5. Does the case have a clear narrative arc, or is it a flat list of unrelated events? (The arc is what makes the timeline visual interesting at demo time.)

If any answer is no, revise before proceeding.

---

## What goes where after authoring

```
data/cases/case1/
├── docs/
│   ├── d1_pcp_2023_01.pdf
│   ├── d2_lab_2023_04.pdf
│   └── ...
├── events.json          ← generated at H7 by `tsx scripts/extract-case.ts case1`
└── metadata.json        ← {patient: "Sarah Chen, 47F", condition: "Type 2 Diabetes", doc_count: 7}

data/cases/case2/
├── docs/...
├── events.json
└── metadata.json

held_out/case3/
├── docs/
│   ├── d1_pcp_2024_01.pdf
│   └── ...
├── ground_truth.json    ← written pre-H0 in same sitting as docs; chmod 444 after
├── .gt_hash.lock        ← `git hash-object ground_truth.json > .gt_hash.lock`
├── prompt_hash.txt      ← written by eval-case3.ts at every Case 3 run
└── README.md            ← "DO NOT OPEN UNTIL H11" warning
```
