# Tests

## GitHub Actions

Workflow: `.github/workflows/smoke-tests.yml`.

Required repository secrets:

- `N8N_INGEST_URL` — public URL of the n8n webhook for `KB — Ingest v1 (Webhook)` (POST JSON).
- `N8N_ANSWER_URL` — public URL of the n8n webhook for an **Answer endpoint** (POST JSON) that returns the Answer workflow output as JSON.

## Local run

```bash
export N8N_INGEST_URL="https://…/webhook/…/kb/ingest"
export N8N_ANSWER_URL="https://…/webhook/…/kb/answer"

bash tests/smoke_ingest.sh
bash tests/smoke_answer.sh
node tests/unit_answer_logic.test.js
```

Optional env vars:

- `SMOKE_KB_REF` — kb_ref used by `tests/smoke_answer.sh` (default: `smoke-ci`).

