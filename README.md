# AI Support Knowledge Base Assistant (RAG)

Portfolio MVP: a customer-support assistant that answers **strictly from a verified knowledge base**, provides **citations**, and uses safe **fallback modes** (`ALLOW` / `CLARIFY` / `NO_ANSWER`) to prevent hallucinations.

Useful links:
- `arch.md` — architecture + Envelope contract
- `plan.md` — implementation plan / checklist
- `prompts/answer.md` — strict KB-only prompt (v1)
- `tests/README.md` — E2E smoke tests (webhooks)

## Problem
Support teams rely on large, frequently changing documentation (KBs, manuals, policies, FAQs). Classic LLM assistants often:
- hallucinate (answer without evidence),
- can’t explain *where* information comes from,
- provide poor traceability and debugging.

## Solution
This project is a simple, auditable RAG system:
- **Ingest**: docs → chunking → embeddings → `kb_chunks` (pgvector)
- **Answer**: question → retrieval (top-k) → confidence gate → KB-only LLM → answer + sources
- **Logging**: each chat turn is logged for debugging/metrics (`Ops — Log chat_turn`)

## Key features (MVP)
- KB-only answering (strict prompt)
- Confidence gating: `ALLOW` / `CLARIFY` / `NO_ANSWER`
- Sources/citations included in the response
- Webhook-based ingest + answer endpoints (easy to smoke-test)
- Centralized logging with `top_score`, latency, and sources

## Architecture (high level)
```mermaid
flowchart LR
    TG[Telegram User] -->|message| TR[TG Inbound Router]

    TR --> ENV[Envelope Build]

    ENV --> CMD{Command Router}

    CMD -->|/help| HELP[Build Help Reply]
    CMD -->|/sources| SRC[DB: List Sources]
    CMD -->|/debug| DBG[Build Debug Reply]
    CMD -->|question| RAG[KB Answer Pipeline]

    %% RAG pipeline
    RAG --> QN[Normalize Question]
    QN --> EMB[Create Embedding]
    EMB --> RET[Vector Search<br/>(kb_chunks)]
    RET --> GATE{Confidence Gate}

    GATE -->|ALLOW| LLM[LLM Answer]
    GATE -->|CLARIFY / NO_ANSWER| FB[Fallback Reply]

    LLM --> PARSE[Parse Answer]
    PARSE --> CITE[Attach Sources]

    %% Merge all replies
    HELP --> OUT
    SRC --> OUT
    DBG --> OUT
    CITE --> OUT
    FB --> OUT

    OUT[Send Telegram Reply]

    %% Logging
    OUT --> LOG[Log chat_turn<br/>(Postgres)]
```

## n8n workflows
Workflows currently live in n8n:
- `TG — Inbound Router (MVP)` — Telegram entrypoint + routing
- `KB — Ingest v1 (Webhook)` — ingest endpoint (docs → chunks → embeddings → `kb_chunks`)
- `KB — Answer v1` — answer pipeline (retrieval + gate + LLM + sources)
- `Ops — Log chat_turn` — writes logs to Postgres/Supabase

## Webhook contracts (used by smoke tests)
The repository contains E2E smoke tests that call your n8n webhooks directly.

### Ingest (`KB — Ingest v1 (Webhook)`)
POST JSON (required fields):
```json
{
  "kb_ref": "demo-support",
  "doc": "Access request process",
  "section": "Onboarding",
  "source_url": "https://example.com/access",
  "text": "# Markdown...\n\nContent...",
  "tags": ["onboarding", "access"],
  "replace": true,
  "doc_id": "optional-stable-id"
}
```

### Answer endpoint
POST JSON:
```json
{
  "kb_ref": "demo-support",
  "question": "What is the SLA for urgent requests?",
  "retrieval": { "top_k": 5 }
}
```

## Running smoke tests (local)
```bash
export N8N_INGEST_URL="https://…/webhook/…/kb/ingest"
export N8N_ANSWER_URL="https://…/webhook/…/kb/answer"

bash tests/smoke_ingest.sh
bash tests/smoke_answer.sh
node tests/unit_answer_logic.test.js
node tests/unit_tg_router_envelope.test.js
```

## Tech stack
- n8n — workflow orchestration
- OpenAI — embeddings + chat completion
- Postgres (Supabase + pgvector) — `kb_chunks` + logs
- Telegram Bot API — user interface

## Status / next steps
See `plan.md` (Day 3): retries/timeouts, `/help`/`/sources`/`/debug`, workflow exports, README screenshots + demo script.
