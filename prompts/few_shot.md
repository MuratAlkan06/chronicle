# Few-shot examples for `emit_events`

These two examples teach the extractor:
1. **Snippet selection** — pick the shortest contiguous span from HPI / A&P / Plan / FINDINGS / DIAGNOSIS sections that *substantively* supports the event. Do NOT pick document headers (e.g. `Date of Service:` lines, `Patient:` lines, `Visit type:` lines) even though they are technically verbatim.
2. **`values` field discipline** — ONLY lab events populate `values` with a single-analyte `{key, value, unit, ref_range, flag}`. All non-lab events (visit, diagnosis, medication, imaging, procedure, referral) emit `values: null`, even when the document contains multiple measurements (vitals on a visit, etc.).
3. **Multi-event-per-document pattern** — a single encounter often produces 3-4 distinct events (visit + lab + dx + med, or visit + referral + imaging + procedure). Emit them all with shared `date` where appropriate.
4. **Multi-document care chains** — events related to one clinical thread (e.g. mammogram → consult → biopsy) live in different PDFs; emit each grounded in its own document.

The two examples together cover all 7 `event_type` values: lab, visit, diagnosis, medication, imaging, referral, procedure.

---

## FEW-SHOT 1 — Sarah Chen PCP encounter (visit + lab + diagnosis + medication on 2023-01-12)

DOCUMENT (`d1_pcp_2023_01.pdf`):

```
Sarah Levy, MD — Internal Medicine
Patient: Chen, Sarah   DOB: 11-Jun-1976 (47F)   MRN: 4471028
Date of Service: 01/12/2023   Visit type: Annual physical

Chief Complaint
Routine annual physical. Patient reports fatigue and increased thirst.

History of Present Illness (HPI)
Pt presents today for routine annual physical. Reports fatigue × 3 months and increased thirst.
She describes the fatigue as a generalized "low energy" feeling, worse in the afternoons.
Polydipsia developed gradually; she now keeps a water bottle at her desk and refills it 3-4× per day.
On direct questioning she notes nocturia × 1 most nights.

Vitals
BP 132/84   HR 78   T 98.4°F   RR 14   SpO2 99% RA   BMI 28.4

Labs (drawn today, results posted same day)
| Test             | Result | Flag | Reference     |
| Glucose, fasting | 187    | H    | 70-99 mg/dL   |
| HbA1c            | 9.2 %  | H    | 4.0-5.6 %     |
| LDL              | 132    | H    | <100 mg/dL    |
HbA1c: 9.2% (H) — Reference range 4.0-5.6%.
Results consistent with new-onset Type 2 diabetes.

Assessment & Plan
Assessment: Type 2 Diabetes Mellitus (E11.9) — added to problem list.
1. T2D, new diagnosis. Initiate metformin per below.
Plan: Start metformin 500 mg PO b.i.d. with meals. F/u in 3 months for repeat A1c.
```

EXPECTED TOOL CALL (`emit_events`):

```json
{
  "events": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "date": "2023-01-12",
      "date_text": "01/12/2023",
      "date_confidence": "exact",
      "event_type": "visit",
      "title": "PCP visit — initial workup",
      "summary": "First visit with Dr. Levy for routine annual physical. Patient reported fatigue and increased thirst over the prior three months.",
      "severity": "info",
      "values": null,
      "provider": "Sarah Levy, MD",
      "source": {
        "document_id": "d1_pcp_2023_01.pdf",
        "page": 1,
        "snippet": "Pt presents today for routine annual physical. Reports fatigue × 3 months and increased thirst."
      },
      "related_ids": []
    },
    {
      "id": "11111111-1111-4111-8111-111111111112",
      "date": "2023-01-12",
      "date_text": "01/12/2023",
      "date_confidence": "exact",
      "event_type": "lab",
      "title": "HbA1c — 9.2%",
      "summary": "Glycated hemoglobin (A1c) significantly elevated, consistent with new-onset diabetes. Reference range 4.0-5.6%.",
      "severity": "concerning",
      "values": {
        "key": "HbA1c",
        "value": "9.2",
        "unit": "%",
        "ref_range": "4.0-5.6",
        "flag": "high"
      },
      "provider": "Sarah Levy, MD",
      "source": {
        "document_id": "d1_pcp_2023_01.pdf",
        "page": 2,
        "snippet": "HbA1c: 9.2% (H) — Reference range 4.0-5.6%."
      },
      "related_ids": []
    },
    {
      "id": "11111111-1111-4111-8111-111111111113",
      "date": "2023-01-12",
      "date_text": "01/12/2023",
      "date_confidence": "exact",
      "event_type": "diagnosis",
      "title": "Dx added: Type 2 Diabetes Mellitus",
      "summary": "Type 2 diabetes added to the active problem list based on elevated HbA1c and presenting symptoms.",
      "severity": "concerning",
      "values": null,
      "provider": "Sarah Levy, MD",
      "source": {
        "document_id": "d1_pcp_2023_01.pdf",
        "page": 3,
        "snippet": "Assessment: Type 2 Diabetes Mellitus (E11.9) — added to problem list."
      },
      "related_ids": []
    },
    {
      "id": "11111111-1111-4111-8111-111111111114",
      "date": "2023-01-12",
      "date_text": "01/12/2023",
      "date_confidence": "exact",
      "event_type": "medication",
      "title": "Started metformin 500 mg b.i.d.",
      "summary": "Metformin 500 mg twice daily started as first-line therapy. Patient counseled on titration plan over the next two weeks.",
      "severity": "monitor",
      "values": null,
      "provider": "Sarah Levy, MD",
      "source": {
        "document_id": "d1_pcp_2023_01.pdf",
        "page": 3,
        "snippet": "Plan: Start metformin 500 mg PO b.i.d. with meals. F/u in 3 months for repeat A1c."
      },
      "related_ids": []
    }
  ]
}
```

Notes (for the model — do not emit notes, just learn from them):

- The visit snippet is the HPI sentence, NOT `Date of Service: 01/12/2023   Visit type: Annual physical`. The header is verbatim but is metadata — the HPI sentence is the clinically discrete moment.
- The visit event has multiple vitals in the document (BP, HR, T, RR, SpO2, BMI). `values` is `null` — vitals on a visit are NOT a single analyte, and the schema rejects free-form key-value maps. If you need to convey vitals, do it in `summary` prose.
- Only the lab event populates `values`, and it does so with a single analyte (HbA1c). The fasting glucose and LDL would each be their own lab event if you choose to emit them; do NOT cram multiple analytes into one `values` object.
- All 4 events share `date: "2023-01-12"` because they all occurred at the same encounter. Same-day grouping is normal.

---

## FEW-SHOT 2 — Maria Rodriguez care chain (visit + referral + imaging + procedure across multiple documents)

DOCUMENTS (concatenated for example purposes — in a real run each PDF is sent separately and produces its own events):

```
=== d1_obgyn_2024_02.pdf — Karen Wu, MD, OB/GYN ===
Patient: Rodriguez, Maria   DOB: 14-Mar-1972 (52F)   MRN: 8821345
Date of Service: February 8, 2024   Visit type: Annual GYN

HPI
Annual GYN visit. Pt c/o no breast complaints. Breast exam: no masses palpated bilaterally. Plan: routine screening mammogram.

Maria returns for her routine annual gynecologic visit. She has no breast complaints
- no pain, no nipple discharge, no skin changes. Family history significant for
maternal aunt with breast cancer dx in her 60s.

A&P
1. Routine annual GYN exam — unremarkable.
   Refer to Breast Imaging Center for screening mammogram.
   Last screening mammogram was 04-Feb-2022 (over the 24-month interval, due now).

=== d2_mammo_2024_02.pdf — Westside Breast Imaging ===
Exam Date: 02/22/2024   Exam: Bilateral screening mammogram, digital breast tomosynthesis

FINDINGS
The breasts are heterogeneously dense (ACR category C).
Right breast:
FINDINGS: 1.2 cm spiculated mass identified in right breast at the 11 o'clock position, approx 3 cm from nipple. ASSESSMENT: BI-RADS 4 — Suspicious abnormality. Biopsy recommended.
The mass is new compared to the 02/2022 prior.

=== d4_surgery_2024_03.pdf — Anil Patel, MD, Breast Surgery ===
Date of Service: March 19, 2024   Visit type: New consultation

HPI
Pt seen in consultation for s/p suspicious mammogram. Reviewed images. Plan: schedule core needle biopsy for next week.

A&P
Procedure: ultrasound-guided core needle biopsy of right breast 11 o'clock mass scheduled for 03/28/2024.

=== d5_biopsy_2024_03.pdf — UCSF Surgical Pathology ===
Specimen Received: 03/28/2024
Procedure: Ultrasound-guided core needle biopsy, right breast, 11 o'clock position

DIAGNOSIS
Pathology: Right breast mass, ultrasound-guided core needle biopsy. DIAGNOSIS: Fibroadenoma, no evidence of malignancy.
```

EXPECTED TOOL CALL (`emit_events`) — events from across the 4 documents above:

```json
{
  "events": [
    {
      "id": "22222222-2222-4222-8222-222222222221",
      "date": "2024-02-08",
      "date_text": "February 8, 2024",
      "date_confidence": "exact",
      "event_type": "visit",
      "title": "OB/GYN annual visit",
      "summary": "Routine annual gynecologic visit. Breast and pelvic exams unremarkable. Screening mammogram ordered as routine.",
      "severity": "info",
      "values": null,
      "provider": "Karen Wu, MD",
      "source": {
        "document_id": "d1_obgyn_2024_02.pdf",
        "page": 1,
        "snippet": "Annual GYN visit. Pt c/o no breast complaints. Breast exam: no masses palpated bilaterally. Plan: routine screening mammogram."
      },
      "related_ids": []
    },
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "date": "2024-02-08",
      "date_text": "February 8, 2024",
      "date_confidence": "exact",
      "event_type": "referral",
      "title": "Referral to imaging — screening mammogram",
      "summary": "Routine screening mammogram ordered through breast imaging center.",
      "severity": "info",
      "values": null,
      "provider": "Karen Wu, MD",
      "source": {
        "document_id": "d1_obgyn_2024_02.pdf",
        "page": 2,
        "snippet": "Refer to Breast Imaging Center for screening mammogram."
      },
      "related_ids": []
    },
    {
      "id": "22222222-2222-4222-8222-222222222223",
      "date": "2024-02-22",
      "date_text": "02/22/2024",
      "date_confidence": "exact",
      "event_type": "imaging",
      "title": "Mammogram — BI-RADS 4 (suspicious)",
      "summary": "Screening mammogram identified a suspicious mass in the right breast at the 11 o'clock position. BI-RADS category 4 — biopsy recommended.",
      "severity": "concerning",
      "values": null,
      "provider": "Westside Breast Imaging",
      "source": {
        "document_id": "d2_mammo_2024_02.pdf",
        "page": 1,
        "snippet": "FINDINGS: 1.2 cm spiculated mass identified in right breast at the 11 o'clock position, approx 3 cm from nipple. ASSESSMENT: BI-RADS 4 — Suspicious abnormality. Biopsy recommended."
      },
      "related_ids": []
    },
    {
      "id": "22222222-2222-4222-8222-222222222224",
      "date": "2024-03-19",
      "date_text": "March 19, 2024",
      "date_confidence": "exact",
      "event_type": "visit",
      "title": "Breast surgery consult",
      "summary": "Surgical consultation. Reviewed mammogram findings with patient. Core needle biopsy planned for following week.",
      "severity": "concerning",
      "values": null,
      "provider": "Anil Patel, MD",
      "source": {
        "document_id": "d4_surgery_2024_03.pdf",
        "page": 1,
        "snippet": "Pt seen in consultation for s/p suspicious mammogram. Reviewed images. Plan: schedule core needle biopsy for next week."
      },
      "related_ids": []
    },
    {
      "id": "22222222-2222-4222-8222-222222222225",
      "date": "2024-03-28",
      "date_text": "03/28/2024",
      "date_confidence": "exact",
      "event_type": "procedure",
      "title": "Core needle biopsy — benign",
      "summary": "Image-guided core needle biopsy of the right breast mass returned benign — fibroadenoma. No evidence of malignancy.",
      "severity": "info",
      "values": null,
      "provider": "Anil Patel, MD",
      "source": {
        "document_id": "d5_biopsy_2024_03.pdf",
        "page": 1,
        "snippet": "Pathology: Right breast mass, ultrasound-guided core needle biopsy. DIAGNOSIS: Fibroadenoma, no evidence of malignancy."
      },
      "related_ids": []
    }
  ]
}
```

Notes (for the model):

- The biopsy is a `procedure` event, NOT an `imaging` event, even though it sits in the same care chain as the mammogram. Imaging = image acquisition + read; procedure = tissue is actually obtained or an intervention is done.
- The mammogram report (`d2_mammo_2024_02.pdf`) is one `imaging` event grounded in its FINDINGS line — not the IMPRESSION list, not the technique block. Pick the most specific contiguous span.
- The OB/GYN visit yields TWO events (visit + referral) because the encounter contains a discrete clinical action (the referral) in addition to the visit itself. The referral snippet comes from the A&P, not a separate header.
- Cross-document care chains share clinical context but each event's snippet must be verbatim from its OWN document. Do not paraphrase across documents.
- Every non-lab event here has `values: null`. There is no lab event in this chain — `values` is unused throughout.
