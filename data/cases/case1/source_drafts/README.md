# Case 1 — Sarah Chen — source drafts → PDFs

Two file formats here for each of the 7 documents:
- `dN_*.md` — the original markdown draft (for reading/reference)
- `dN_*.html` — pre-cleaned, print-ready HTML (use this for PDF export)

## Recommended workflow — Chrome print-to-PDF (~5 min total)

For each `.html` file:
1. Double-click to open it in Chrome (or right-click → Open With → Chrome).
2. `Cmd+P` to open the print dialog.
3. **Destination:** "Save as PDF". **Layout:** Portrait. **Margins:** Default. **Paper size:** Letter.
4. Save with the matching filename: `d1_pcp_2023_01.pdf`, `d2_lab_2023_04.pdf`, etc.
5. Drop into the sibling `data/cases/case1/docs/` directory.

Page breaks, tables, headers, and the contradiction (metformin 1000 mg in d3 vs 850 mg in d5) are all baked in. Snippet markers from the markdown are already stripped — the snippet text itself remains verbatim (it's the ground-truth string the model needs to find via the Citations API).

## Filename rule (must match `MOCK_DATA.md` exactly)

```
data/cases/case1/docs/
├── d1_pcp_2023_01.pdf
├── d2_lab_2023_04.pdf
├── d3_pcp_2023_05.pdf
├── d4_lab_2023_08.pdf
├── d5_pcp_2023_11.pdf
├── d6_lab_2024_04.pdf
└── d7_pcp_2024_07.pdf
```

## If you'd rather use Google Docs instead

Open the `.html` in Chrome → `Cmd+A` → `Cmd+C` → paste into a new Google Doc → File → Download → PDF Document. Page-break CSS doesn't survive paste, so you'll need to insert hard page breaks (`Cmd+Enter`) manually at the spots where new sections start. Slower than the print-to-PDF route.
