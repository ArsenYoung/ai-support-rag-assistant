# AI Support Knowledge Base Assistant (RAG)

An AI support assistant that **answers only from your verified knowledge base**, ships with **citations by default**, and refuses to hallucinate (`ALLOW / CLARIFY / NO_ANSWER`). Built for teams that need trustworthy, auditable replies fast.

## Why teams buy this
- **Trust first:** Every answer cites KB chunks; unknowns fall back to safe clarifications.
- **Production-safe:** Confidence gate, timeouts, retries, and structured fallbacks already wired.
- **Auditable:** Each turn is logged with scores, latency, and sources for instant RCA.
- **Fast rollout:** Two webhooks (ingest + answer), Telegram front-end, and ready scripts to prove value in minutes.

## What’s inside (lean)
- RAG pipeline: ingest → chunk → embed → vector search → gate → KB-only LLM → citations.
- Confidence guardrails: `ALLOW` / `CLARIFY` / `NO_ANSWER` to prevent hallucinations.
- Telemetry: `top_score`, latency, sources logged for every chat turn.

## n8n workflows (ready to import)
- `KB — Ingest v1 (Webhook)` — docs → chunks → embeddings → `kb_chunks`
- `KB — Answer v1` — retrieval + gate + LLM + citations
- `TG — Inbound Router (MVP)` — Telegram entrypoint and commands (`/help`, `/sources`, `/debug`)
- `Ops — Log chat_turn` — durable logging to Postgres/Supabase

## Webhook contracts
- **Ingest** (`kb/ingest`): `kb_ref`, `doc`, `section`, `text`, optional `source_url`, `tags[]`, `doc_id`, `replace`.
- **Answer** (`kb/answer`): `kb_ref`, `question`, optional `retrieval.top_k` (default 5).

## Prove it fast (local smoke)
```bash
export N8N_INGEST_URL="https://…/webhook/…/kb/ingest"
export N8N_ANSWER_URL="https://…/webhook/…/kb/answer"

bash tests/smoke_ingest.sh
bash tests/smoke_answer.sh
```

## Tech
n8n · OpenAI · Postgres/pgvector (Supabase) · Telegram Bot API
