const test = require('node:test');
const assert = require('node:assert/strict');

function safeStr(v) {
  return v === null || v === undefined ? '' : String(v);
}

function buildEnvelope(telegramUpdate) {
  const traceId = '00000000-0000-4000-8000-000000000000';
  const t0 = 1700000000000;

  const msg = telegramUpdate?.message ?? {};
  const chatId = msg?.chat?.id ?? null;
  const userId = msg?.from?.id ?? 'unknown';
  const text = msg?.text ?? '';

  return {
    meta: {
      request_id: traceId,
      ts: new Date(t0).toISOString(),
      channel: 'telegram',
      prompt_version: 'v1',
      chat_model: 'day1_stub',
      embedding_model: 'n/a',
      chat_id: chatId ? Number(chatId) : null,
    },
    input: {
      user_id: safeStr(userId),
      question: safeStr(text).trim(),
    },
    telegram: telegramUpdate ?? null,
    retrieval: { top_k: 5, hits: [], top_score: null },
    decision: { mode: 'ALLOW', reason: 'day1_stub' },
    output: { answer: '', sources: [] },
    error: null,
    timers: { t_start_ms: t0 },
  };
}

test('Envelope build: normal message', () => {
  const env = buildEnvelope({
    message: {
      chat: { id: 123 },
      from: { id: 456 },
      text: '  hello  ',
    },
  });

  assert.equal(env.meta.channel, 'telegram');
  assert.equal(env.meta.chat_id, 123);
  assert.equal(env.input.user_id, '456');
  assert.equal(env.input.question, 'hello');
  assert.equal(env.retrieval.top_k, 5);
  assert.equal(env.decision.mode, 'ALLOW');
});

test('Envelope build: missing fields -> safe defaults', () => {
  const env = buildEnvelope({});
  assert.equal(env.meta.channel, 'telegram');
  assert.equal(env.meta.chat_id, null);
  assert.equal(env.input.user_id, 'unknown');
  assert.equal(env.input.question, '');
});

