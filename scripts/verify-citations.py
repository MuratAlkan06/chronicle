#!/usr/bin/env python3
"""Block 5b — Anthropic Citations API smoke test for Chronicle.

Persisted from /tmp/verify_citations.py for reproducibility. Verified that
the hybrid text-block + tool_use pattern documented in
docs/extraction-prompt-v1.md does NOT yield citations:

  | Test | tool_choice         | Text blocks | Citations | Tool events |
  |------|---------------------|-------------|-----------|-------------|
  | 1    | {type: "tool"}      | 0           | 0         | 6           |
  | 2    | {type: "auto"}      | 1           | 0         | 6           |

Decision: drop Citations API entirely. Take BUILD.md Risk 1 worst-case
fallback path — model emits snippet inside tool_use input, lib/match.ts
sliding-window-validates against the PDF text-layer.

Run: ANTHROPIC_API_KEY=... python3 scripts/verify-citations.py
Cost: ~$0.06 per invocation (one PDF, two API calls).
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "data/cases/case1/docs/d1_pcp_2023_01.pdf")

api_key = os.environ.get("ANTHROPIC_API_KEY")
if not api_key:
    env_local = os.path.join(ROOT, ".env.local")
    if os.path.exists(env_local):
        with open(env_local) as f:
            for line in f:
                line = line.strip()
                if line.startswith("ANTHROPIC_API_KEY="):
                    api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
if not api_key:
    print("ERROR: ANTHROPIC_API_KEY not set (env or .env.local)", file=sys.stderr)
    sys.exit(2)

with open(PDF, "rb") as f:
    pdf_b64 = base64.standard_b64encode(f.read()).decode("ascii")

SYSTEM = "You are a medical-records timeline extractor. Call the emit_events tool with all clinically discrete events from the attached PDF. Each event's source.snippet must be a verbatim quote from the document."

TOOL = {
    "name": "emit_events",
    "description": "Emit the structured list of clinical events extracted from this document.",
    "input_schema": {
        "type": "object",
        "properties": {
            "events": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "date": {"type": "string"},
                        "event_type": {"type": "string"},
                        "title": {"type": "string"},
                        "summary": {"type": "string"},
                        "severity": {"type": "string"},
                        "source": {
                            "type": "object",
                            "properties": {
                                "document_id": {"type": "string"},
                                "page": {"type": "integer"},
                                "snippet": {"type": "string"},
                            },
                            "required": ["document_id", "page", "snippet"],
                        },
                    },
                    "required": ["id", "date", "event_type", "title", "summary", "severity", "source"],
                },
            },
        },
        "required": ["events"],
    },
}


def call(tool_choice):
    body = {
        "model": "claude-sonnet-4-6",
        "max_tokens": 4096,
        "system": SYSTEM,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64,
                        },
                        "citations": {"enabled": True},
                    },
                    {"type": "text", "text": "Extract events. Snippets must be verbatim."},
                ],
            }
        ],
        "tools": [TOOL],
        "tool_choice": tool_choice,
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def summarize(label, resp):
    text_blocks = [b for b in resp.get("content", []) if b.get("type") == "text"]
    tool_blocks = [b for b in resp.get("content", []) if b.get("type") == "tool_use"]
    citations_attached = sum(1 for b in text_blocks if b.get("citations"))
    tool_events = sum(len(b.get("input", {}).get("events", [])) for b in tool_blocks)
    print(f"--- {label} ---")
    print(f"  text_blocks={len(text_blocks)} citations_attached={citations_attached}")
    print(f"  tool_blocks={len(tool_blocks)} tool_events={tool_events}")
    print(f"  usage={resp.get('usage')}")


print("Test 1: tool_choice={type: 'tool'} (forced)")
summarize("forced", call({"type": "tool", "name": "emit_events"}))

print()
print("Test 2: tool_choice={type: 'auto'}")
summarize("auto", call({"type": "auto"}))

print()
print("Conclusion: hybrid text-block+tool_use does NOT yield citations under either tool_choice.")
print("See prompts/system_extract_v1.md preamble for the as-built decision.")
