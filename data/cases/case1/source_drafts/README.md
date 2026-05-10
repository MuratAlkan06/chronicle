# Case 1 — Sarah Chen — source drafts → PDFs

These markdown drafts are the *content* of the 7 PDFs for Case 1. They are NOT
the PDFs themselves. To convert each draft to a PDF for `data/cases/case1/docs/`:

**Easiest path (Word):**
1. Open the `.md` file. Each `--- PAGE N ---` marker = a new page.
2. Copy the body text into Microsoft Word or Google Docs.
3. Light formatting: bold the section headers (HPI, A&P, etc.), keep body text
   plain. Insert a hard page break at each `--- PAGE N ---` marker. No need
   to make it pretty — judges won't see the PDFs, only the extraction does.
4. Export → PDF. Save as `dN_xxx.pdf` (filename must match `document_id` in
   `MOCK_DATA.md` exactly: `d1_pcp_2023_01.pdf`, etc.).
5. Drop into `data/cases/case1/docs/`.

**Alternate (Pages on macOS):** same flow, "Export To → PDF…".

**Verbatim-snippet rule (important):**
Each draft contains lines marked `[SNIPPET — DO NOT EDIT]`. Those exact
strings must appear in the PDF without paraphrase, capitalization changes, or
whitespace edits — they are the ground-truth `source.snippet` values in
`MOCK_DATA.md` and the model needs to find them via the Citations API.
Everything else is filler text you can rephrase if you want.

**Per-doc requirements (BUILD.md Block 3, Q22):**
- ≥2 medical abbreviations per doc — the drafts already include these.
- ≥1 date format inconsistency per doc (mix MM/DD/YYYY, DD-MMM-YYYY, long-form) — already woven in.
- 1 cross-doc contradiction across the case — built into d3 vs d5
  (metformin 1000 mg b.i.d. in May vs 850 mg b.i.d. in November).

Total: 7 PDFs × ~1–3 pages each. Should take ~30–45 min if you don't fuss
with formatting.
