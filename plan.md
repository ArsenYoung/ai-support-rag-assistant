# План на 3 дня для портфолио-версии RAG-ассистента

## День 1 — продуктовый каркас (бот, трейсинг, ответ с источниками без RAG) (2 часа потрачено с учетом архитектуры и плана)
- ~~n8n: Telegram Inbound Router (MVP) — принять сообщение, собрать Envelope v2 (`meta.request_id`, `meta.channel`, `input.user_id`, `input.question`, `telegram`, `timers.t_start_ms`), замер `latency_ms`, отправить простой ответ, записать лог.~~
- ~~Supabase схема (минимум):~~
  - ~~`chat_turns`: `trace_id`, `user_id`, `question`, `answer`, `top_score`, `fallback_type`, `prompt_version`, `model`, `latency_ms`, `sources_json`, `created_at`.~~
  - ~~`kb_chunks`: пока пустая (`id`, `content`, `embedding`, `title`, `source`, `url`, `created_at`).~~
- ~~Ожидаемый результат: бот отвечает и логирует `chat_turns`;~~

## День 2 — сердце RAG (ingest → retrieval → gating → ответ с цитатами)
- ~~n8n: KB — Ingest v1 (быстрый): demo docs → chunking (overlap) → embeddings → upsert в `kb_chunks` (metadata типа `doc/section/source_url`).~~
- ~~n8n: KB — Ingest v1 (Webhook): Webhook input (JSON: `kb_ref`, `doc`, `section`, `source_url`, `text`, `tags[]`, `replace`, опционально `doc_id`) вместо хардкода demo docs.~~
- ~~Retrieval: embedding вопроса → vector search topK → `hits[]`, метрики `top_score`, `hit_count` (реализовано внутри `KB — Answer v1`).~~
- ~~Gating: пороги — `top_score < T1` или `hit_count=0` → `fallback_type="NO_ANSWER"` или CLARIFY; `T1..T2` → осторожный ответ + 1 уточнение; `>=T2` → уверенный ответ. Логи в `chat_turns`: `top_score`, `fallback_type`, `sources_json`.~~
- ~~Answer v1: строго по контексту + “Источники” (2–5, `title/url`), без фантазий.~~
- ~~Демо-данные: заинжестить 2–3 дока (“Support SLA & response times”, “Refund / cancellation policy”, “Onboarding / access request process”).~~
- ~~Ожидаемый результат: RAG с 3 режимами (answer/clarify/no_answer), ответы с источниками, в Supabase видно `top_score` и источники.~~
- ~~`/prompts/answer.md v1`: KB-only + no-hallucinations; LLM output — strict JSON (`mode/answer/clarify/sources`); логировать `prompt_version="v1"` и `chat_model`/`embedding_model`.~~

## День 3 — упаковка (команды, устойчивость, README-лендинг, демо)
- Мини-устойчивость: таймауты на внешние вызовы (LLM/embeddings/Supabase), retry/backoff на 429 (1–2 попытки), дружелюбный ответ при ошибке + запись в `chat_turns`.
- Команды: `/help` (что умеет, 5 строк), `/sources` (список `title/url`), `/debug` (показать `top_score`, `fallback_type`, top-3 источника).
- README как лендинг: Problem → Solution; Key features (Citations, Gating, Traceability); How it works (Mermaid); Tech stack; Demo script (5 вопросов); Screenshots; Next steps (PDF/web ingest, dashboards, RBAC).
- Демо-скрипт (60–90 сек, Loom): показать `/sources`; вопрос по базе → ответ + источники; вопрос вне базы → CLARIFY/NO_ANSWER; `/debug` с `top_score`; строка в `chat_turns`.
- Портфолио-пакет: 1 диаграмма (Mermaid → PNG), 3–5 скринов Telegram, 1 скрин Supabase `chat_turns`, видео (Loom), `sample_kb/` с 2–3 доками.
- Ожидаемый результат: выглядит как готовое B2B-решение — предсказуемые фолбэки, цитаты/источники, debug/traceability, README-лендинг, демо-видео.
