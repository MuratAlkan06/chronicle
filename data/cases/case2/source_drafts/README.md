# Case 2 — Maria Rodriguez — source drafts → PDFs

Two file formats here for each of the 6 documents:
- `dN_*.md` — the original markdown draft (for reading/reference)
- `dN_*.html` — pre-cleaned, print-ready HTML (use this for PDF export)

## Recommended workflow — Chrome print-to-PDF (~4 min total)

For each `.html` file:
1. Double-click to open it in Chrome.
2. `Cmd+P` → **Destination:** "Save as PDF" → **Margins:** Default → **Paper size:** Letter.
3. Save with the matching filename: `d1_obgyn_2024_02.pdf`, `d2_mammo_2024_02.pdf`, etc.
4. Drop into the sibling `data/cases/case2/docs/` directory.

The cross-doc contradiction (1 o'clock typo in d4's HPI vs 11 o'clock in d2's mammogram report) is already woven in.

## Filename rule (must match `MOCK_DATA.md` exactly)

```
data/cases/case2/docs/
├── d1_obgyn_2024_02.pdf
├── d2_mammo_2024_02.pdf
├── d3_referral_2024_03.pdf
├── d4_surgery_2024_03.pdf
├── d5_biopsy_2024_03.pdf
└── d6_obgyn_2024_05.pdf
```

## Google Docs alternative

Open the `.html` in Chrome → `Cmd+A` → `Cmd+C` → paste into a new Google Doc → File → Download → PDF Document. Insert hard page breaks (`Cmd+Enter`) manually where new sections start; CSS page-breaks don't survive paste.
