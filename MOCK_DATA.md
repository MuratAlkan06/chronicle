# Chronicle — Mock Data Fixtures

Cross-session contract: frontend session imports these as fixtures while backend builds the real extraction pipeline. Backend should generate identical-shape responses against the same cases.

**Cases 1+2 are real fixtures** — used by the demo at `/app` and as the basis for cached preset responses at H7. These represent the schema-correct extraction output Murat should aim for. The narrative arcs match [docs/CASES.md](docs/CASES.md).

**Case 3 is a SHAPE-ONLY MOCK** — labeled `mock_only_not_eval_data: true`. Used to scaffold `/eval` UI ONLY. **Does not predict actual ground-truth or model output.** Real Case 3 extraction runs live at H11 per the held-out discipline. Predicting Case 3 events here would be a held-out hygiene violation.

---

## Notes on IDs

Fixture event IDs use UUID v4 format with case-prefixed sequential bytes for human readability (e.g., `c1000001-0000-4000-8001-000000000001` = Case 1, event 1). Production extraction will use `crypto.randomUUID()`.

---

## Case 1 — Sarah Chen, 47F, Type 2 Diabetes progression

```json
{
  "case_id": "case1",
  "patient": "Sarah Chen, 47F",
  "condition": "Type 2 Diabetes Mellitus",
  "events": [
    {
      "id": "c1000001-0000-4000-8001-000000000001",
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
      "related_ids": ["c1000001-0000-4000-8001-000000000002", "c1000001-0000-4000-8001-000000000003", "c1000001-0000-4000-8001-000000000004"]
    },
    {
      "id": "c1000001-0000-4000-8001-000000000002",
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
      "related_ids": ["c1000001-0000-4000-8001-000000000005", "c1000001-0000-4000-8001-000000000008"]
    },
    {
      "id": "c1000001-0000-4000-8001-000000000003",
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
      "id": "c1000001-0000-4000-8001-000000000004",
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
      "related_ids": ["c1000001-0000-4000-8001-000000000007", "c1000001-0000-4000-8001-000000000010"]
    },
    {
      "id": "c1000001-0000-4000-8001-000000000005",
      "date": "2023-04-18",
      "date_text": "18-Apr-2023",
      "date_confidence": "exact",
      "event_type": "lab",
      "title": "HbA1c — 8.4%",
      "summary": "A1c improving but still above goal of 7%. Patient reports good adherence to metformin.",
      "severity": "monitor",
      "values": {
        "key": "HbA1c",
        "value": "8.4",
        "unit": "%",
        "ref_range": "4.0-5.6",
        "flag": "high"
      },
      "provider": "Quest Diagnostics",
      "source": {
        "document_id": "d2_lab_2023_04.pdf",
        "page": 1,
        "snippet": "Test: Hemoglobin A1c. Result: 8.4 % (H). Reference: 4.0-5.6 %."
      },
      "related_ids": ["c1000001-0000-4000-8001-000000000002", "c1000001-0000-4000-8001-000000000008"]
    },
    {
      "id": "c1000001-0000-4000-8001-000000000006",
      "date": "2023-05-10",
      "date_text": "May 10, 2023",
      "date_confidence": "exact",
      "event_type": "visit",
      "title": "PCP follow-up — A1c discussion",
      "summary": "Reviewed three-month A1c. Patient adherent to metformin without GI side effects. Plan to titrate dose for tighter glycemic control.",
      "severity": "info",
      "values": null,
      "provider": "Sarah Levy, MD",
      "source": {
        "document_id": "d3_pcp_2023_05.pdf",
        "page": 1,
        "snippet": "Pt returns for f/u of T2D. A1c 8.4% on metformin 500 b.i.d. Tolerating well, no GI sx."
      },
      "related_ids": []
    },
    {
      "id": "c1000001-0000-4000-8001-000000000007",
      "date": "2023-05-10",
      "date_text": "May 10, 2023",
      "date_confidence": "exact",
      "event_type": "medication",
      "title": "Increased metformin to 1000 mg b.i.d.",
      "summary": "Metformin titrated up from 500 mg to 1000 mg twice daily based on suboptimal A1c.",
      "severity": "monitor",
      "values": null,
      "provider": "Sarah Levy, MD",
      "source": {
        "document_id": "d3_pcp_2023_05.pdf",
        "page": 2,
        "snippet": "Δ metformin → 1000 mg PO b.i.d. F/u A1c in 3 months."
      },
      "related_ids": ["c1000001-0000-4000-8001-000000000004", "c1000001-0000-4000-8001-000000000010"]
    },
    {
      "id": "c1000001-0000-4000-8001-000000000008",
      "date": "2023-08-21",
      "date_text": "08/21/2023",
      "date_confidence": "exact",
      "event_type": "lab",
      "title": "HbA1c — 7.2%",
      "summary": "A1c continues to improve, approaching goal range. Patient demonstrating sustained response to dose increase.",
      "severity": "monitor",
      "values": {
        "key": "HbA1c",
        "value": "7.2",
        "unit": "%",
        "ref_range": "4.0-5.6",
        "flag": "high"
      },
      "provider": "Quest Diagnostics",
      "source": {
        "document_id": "d4_lab_2023_08.pdf",
        "page": 1,
        "snippet": "Hemoglobin A1c: 7.2 % (H). Reference range 4.0-5.6 %."
      },
      "related_ids": ["c1000001-0000-4000-8001-000000000002", "c1000001-0000-4000-8001-000000000005", "c1000001-0000-4000-8001-000000000011"]
    },
    {
      "id": "c1000001-0000-4000-8001-000000000009",
      "date": "2023-11-14",
      "date_text": "11/14/2023",
      "date_confidence": "exact",
      "event_type": "visit",
      "title": "PCP follow-up — lifestyle counseling",
      "summary": "A1c stable. Discussed Mediterranean dietary pattern and walking program. Patient agreeable to lifestyle modifications.",
      "severity": "info",
      "values": null,
      "provider": "Sarah Levy, MD",
      "source": {
        "document_id": "d5_pcp_2023_11.pdf",
        "page": 1,
        "snippet": "T2D well controlled on current regimen. Discussed dietary changes, encouraged 30 min walking daily."
      },
      "related_ids": []
    },
    {
      "id": "c1000001-0000-4000-8001-000000000010",
      "date": "2023-11-14",
      "date_text": "11/14/2023",
      "date_confidence": "exact",
      "event_type": "medication",
      "title": "Continue metformin 850 mg b.i.d.",
      "summary": "Regimen continued. Note: medication list reflects 850 mg b.i.d., a discrepancy with the May visit's 1000 mg b.i.d. titration. Worth confirming with patient at next visit.",
      "severity": "monitor",
      "values": null,
      "provider": "Sarah Levy, MD",
      "source": {
        "document_id": "d5_pcp_2023_11.pdf",
        "page": 2,
        "snippet": "Continue metformin 850 mg PO b.i.d. as currently prescribed."
      },
      "related_ids": ["c1000001-0000-4000-8001-000000000007"]
    },
    {
      "id": "c1000001-0000-4000-8001-000000000011",
      "date": "2024-04-03",
      "date_text": "04/03/2024",
      "date_confidence": "exact",
      "event_type": "lab",
      "title": "HbA1c — 6.9%",
      "summary": "A1c at goal for the first time. Sustained glycemic control over 15 months of treatment.",
      "severity": "info",
      "values": {
        "key": "HbA1c",
        "value": "6.9",
        "unit": "%",
        "ref_range": "4.0-5.6",
        "flag": "high"
      },
      "provider": "Quest Diagnostics",
      "source": {
        "document_id": "d6_lab_2024_04.pdf",
        "page": 1,
        "snippet": "Hemoglobin A1c: 6.9 % (H). Reference range 4.0-5.6 %. Note: at target for diabetic patients (<7.0)."
      },
      "related_ids": ["c1000001-0000-4000-8001-000000000008"]
    },
    {
      "id": "c1000001-0000-4000-8001-000000000012",
      "date": "2024-04-03",
      "date_text": "04/03/2024",
      "date_confidence": "exact",
      "event_type": "lab",
      "title": "LDL — 145 mg/dL (borderline high)",
      "summary": "LDL cholesterol borderline elevated. Discussion priority for next visit; may warrant statin consideration in the context of T2D.",
      "severity": "monitor",
      "values": {
        "key": "LDL",
        "value": "145",
        "unit": "mg/dL",
        "ref_range": "<100",
        "flag": "high"
      },
      "provider": "Quest Diagnostics",
      "source": {
        "document_id": "d6_lab_2024_04.pdf",
        "page": 2,
        "snippet": "LDL Cholesterol: 145 mg/dL (H). Reference: <100 mg/dL optimal."
      },
      "related_ids": []
    },
    {
      "id": "c1000001-0000-4000-8001-000000000013",
      "date": "2024-07-22",
      "date_text": "07/22/2024",
      "date_confidence": "exact",
      "event_type": "visit",
      "title": "Annual physical exam",
      "summary": "Routine annual visit. T2D well controlled. Discussed LDL elevation from April labs and agreed on lifestyle-first approach with recheck in six months.",
      "severity": "info",
      "values": null,
      "provider": "Sarah Levy, MD",
      "source": {
        "document_id": "d7_pcp_2024_07.pdf",
        "page": 1,
        "snippet": "Annual physical. PMH: T2D (well-controlled), HLD (borderline). Will recheck lipids in 6 months."
      },
      "related_ids": ["c1000001-0000-4000-8001-000000000012"]
    }
  ]
}
```

---

## Case 2 — Maria Rodriguez, 52F, Suspicious mammogram → benign biopsy

```json
{
  "case_id": "case2",
  "patient": "Maria Rodriguez, 52F",
  "condition": "Suspicious breast finding (resolved benign)",
  "events": [
    {
      "id": "c2000002-0000-4000-8002-000000000001",
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
      "related_ids": ["c2000002-0000-4000-8002-000000000002", "c2000002-0000-4000-8002-000000000003"]
    },
    {
      "id": "c2000002-0000-4000-8002-000000000002",
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
      "related_ids": ["c2000002-0000-4000-8002-000000000003"]
    },
    {
      "id": "c2000002-0000-4000-8002-000000000003",
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
      "related_ids": ["c2000002-0000-4000-8002-000000000005"]
    },
    {
      "id": "c2000002-0000-4000-8002-000000000004",
      "date": "2024-03-05",
      "date_text": "03/05/2024",
      "date_confidence": "exact",
      "event_type": "referral",
      "title": "Referral to breast surgery",
      "summary": "Referred to breast surgery for biopsy and surgical evaluation following BI-RADS 4 mammogram finding.",
      "severity": "concerning",
      "values": null,
      "provider": "Karen Wu, MD",
      "source": {
        "document_id": "d3_referral_2024_03.pdf",
        "page": 1,
        "snippet": "Refer to Dr. Patel, Breast Surgery, for evaluation of suspicious mass r/o malignancy."
      },
      "related_ids": []
    },
    {
      "id": "c2000002-0000-4000-8002-000000000005",
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
      "related_ids": ["c2000002-0000-4000-8002-000000000006"]
    },
    {
      "id": "c2000002-0000-4000-8002-000000000006",
      "date": "2024-03-19",
      "date_text": "March 19, 2024",
      "date_confidence": "exact",
      "event_type": "procedure",
      "title": "Core needle biopsy scheduled",
      "summary": "Image-guided core needle biopsy of right breast lesion scheduled.",
      "severity": "concerning",
      "values": null,
      "provider": "Anil Patel, MD",
      "source": {
        "document_id": "d4_surgery_2024_03.pdf",
        "page": 2,
        "snippet": "Procedure: ultrasound-guided core needle biopsy of right breast 11 o'clock mass scheduled for 03/28/2024."
      },
      "related_ids": ["c2000002-0000-4000-8002-000000000007"]
    },
    {
      "id": "c2000002-0000-4000-8002-000000000007",
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
      "related_ids": ["c2000002-0000-4000-8002-000000000003", "c2000002-0000-4000-8002-000000000006"]
    },
    {
      "id": "c2000002-0000-4000-8002-000000000008",
      "date": "2024-05-02",
      "date_text": "05/02/2024",
      "date_confidence": "exact",
      "event_type": "visit",
      "title": "OB/GYN follow-up — benign result discussion",
      "summary": "Follow-up to discuss benign biopsy result with patient. Reassurance provided. Routine screening interval recommended going forward.",
      "severity": "info",
      "values": null,
      "provider": "Karen Wu, MD",
      "source": {
        "document_id": "d6_obgyn_2024_05.pdf",
        "page": 1,
        "snippet": "Pt returns to discuss benign biopsy result. Reassured. Will resume routine annual screening mammogram."
      },
      "related_ids": ["c2000002-0000-4000-8002-000000000007"]
    }
  ]
}
```

---

## Case 3 — David Park, 38M (SHAPE-MOCK ONLY)

> **`mock_only_not_eval_data: true`**
>
> This is **NOT** the actual ground-truth or model prediction for Case 3. It's a representative-shape mock used to scaffold `/eval` UI ONLY. Real Case 3 extraction runs live at H11 per the held-out discipline. Do not use this as a basis for prompt iteration.

```json
{
  "case_id": "case3",
  "mock_only_not_eval_data": true,
  "patient": "David Park, 38M",
  "condition": "Chronic low back pain (mock data — not eval ground truth)",
  "events": [
    {
      "id": "c3000003-0000-4000-8003-000000000001",
      "date": "2024-01-15",
      "date_text": "01/15/2024",
      "date_confidence": "exact",
      "event_type": "visit",
      "title": "PCP visit — low back pain (MOCK)",
      "summary": "MOCK ONLY. Initial PCP visit for low back pain.",
      "severity": "monitor",
      "values": null,
      "provider": "MOCK Provider, MD",
      "source": {
        "document_id": "MOCK_d1.pdf",
        "page": 1,
        "snippet": "MOCK ONLY — not actual extraction output. Used for /eval UI scaffolding only."
      },
      "related_ids": []
    },
    {
      "id": "c3000003-0000-4000-8003-000000000002",
      "date": "2024-01-22",
      "date_text": "01/22/2024",
      "date_confidence": "exact",
      "event_type": "referral",
      "title": "Referral to orthopedics (MOCK)",
      "summary": "MOCK ONLY.",
      "severity": "monitor",
      "values": null,
      "provider": "MOCK Provider, MD",
      "source": {
        "document_id": "MOCK_d2.pdf",
        "page": 1,
        "snippet": "MOCK ONLY — not actual extraction output."
      },
      "related_ids": []
    },
    {
      "id": "c3000003-0000-4000-8003-000000000003",
      "date": "2024-02-12",
      "date_text": "02/12/2024",
      "date_confidence": "exact",
      "event_type": "visit",
      "title": "Orthopedics consult (MOCK)",
      "summary": "MOCK ONLY.",
      "severity": "monitor",
      "values": null,
      "provider": "MOCK Provider, MD",
      "source": {
        "document_id": "MOCK_d3.pdf",
        "page": 1,
        "snippet": "MOCK ONLY — not actual extraction output."
      },
      "related_ids": []
    },
    {
      "id": "c3000003-0000-4000-8003-000000000004",
      "date": "2024-03-05",
      "date_text": "03/05/2024",
      "date_confidence": "exact",
      "event_type": "imaging",
      "title": "MRI lumbar spine (MOCK)",
      "summary": "MOCK ONLY.",
      "severity": "concerning",
      "values": null,
      "provider": "MOCK Imaging Center",
      "source": {
        "document_id": "MOCK_d4.pdf",
        "page": 1,
        "snippet": "MOCK ONLY — not actual extraction output."
      },
      "related_ids": []
    },
    {
      "id": "c3000003-0000-4000-8003-000000000005",
      "date": "2024-04-18",
      "date_text": "04/18/2024",
      "date_confidence": "exact",
      "event_type": "medication",
      "title": "Started gabapentin (MOCK)",
      "summary": "MOCK ONLY.",
      "severity": "monitor",
      "values": null,
      "provider": "MOCK Provider, MD",
      "source": {
        "document_id": "MOCK_d7.pdf",
        "page": 1,
        "snippet": "MOCK ONLY — not actual extraction output."
      },
      "related_ids": []
    },
    {
      "id": "c3000003-0000-4000-8003-000000000006",
      "date": "2024-06-10",
      "date_text": "06/10/2024",
      "date_confidence": "exact",
      "event_type": "visit",
      "title": "PCP follow-up — symptoms persist (MOCK)",
      "summary": "MOCK ONLY.",
      "severity": "monitor",
      "values": null,
      "provider": "MOCK Provider, MD",
      "source": {
        "document_id": "MOCK_d8.pdf",
        "page": 1,
        "snippet": "MOCK ONLY — not actual extraction output."
      },
      "related_ids": []
    }
  ]
}
```
