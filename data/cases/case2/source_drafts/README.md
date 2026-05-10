# Case 2 — Maria Rodriguez — source drafts → PDFs

These markdown drafts are the *content* of the 6 PDFs for Case 2. They are NOT
the PDFs themselves. Conversion workflow is identical to Case 1 — see
`data/cases/case1/source_drafts/README.md`.

**Verbatim-snippet rule:** lines marked `[SNIPPET — DO NOT EDIT]` must appear
in the PDF without changes — they are the ground-truth `source.snippet`
values in `MOCK_DATA.md`.

**Per-doc requirements (BUILD.md Block 3, Q22):**
- ≥2 medical abbreviations per doc — already present.
- ≥1 date format inconsistency per doc — woven in.
- 1 cross-doc contradiction across the case — built into d4 (surgery
  consult). The HPI prose mistakenly cites the mass at the **1 o'clock**
  position when reviewing the mammogram; the actual mammogram report (d2)
  states **11 o'clock**. The procedure section of d4 itself uses the
  correct 11 o'clock position. This is the realistic kind of typo / dictation
  error patient records are full of.

Filename rule: must match `document_id` in `MOCK_DATA.md` exactly:
`d1_obgyn_2024_02.pdf`, `d2_mammo_2024_02.pdf`, `d3_referral_2024_03.pdf`,
`d4_surgery_2024_03.pdf`, `d5_biopsy_2024_03.pdf`, `d6_obgyn_2024_05.pdf`.

Total: 6 PDFs × ~1–2 pages each. ~25–30 min if you don't fuss with formatting.
