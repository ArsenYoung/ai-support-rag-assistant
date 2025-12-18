const test = require('node:test');
const assert = require('node:assert/strict');

function gateDecide({ topScore, hitsCount, cfg }) {
  const config = {
    minHits: 1,
    tClarify: 0.46,
    tAllow: 0.52,
    ...cfg,
  };

  let mode = 'NO_ANSWER';
  let reason = 'no_hits';

  if (hitsCount < config.minHits) {
    mode = 'NO_ANSWER';
    reason = 'no_hits';
  } else if (topScore >= config.tAllow) {
    mode = 'ALLOW';
    reason = 'ok';
  } else if (topScore >= config.tClarify) {
    mode = 'CLARIFY';
    reason = 'low_confidence';
  } else {
    mode = 'NO_ANSWER';
    reason = 'low_similarity';
  }

  const output = { answer: '', sources: [] };
  if (mode !== 'ALLOW') {
    if (mode === 'CLARIFY') {
      output.answer =
        'I found partially relevant info in the knowledge base, but I need a bit more detail to answer.\n\n' +
        'What to clarify:\n' +
        '- Which exact section/process are you referring to (function/page/step name)?\n' +
        '- Which system/integration is this about (if there are multiple)?';
    } else {
      output.answer =
        'I couldn’t find an answer in the knowledge base for this question.\n\n' +
        'What you can do:\n' +
        '- Rephrase the question\n' +
        '- Add 1–2 details (feature/section name, error code, step in the process)';
    }
  }

  return { decision: { mode, reason }, output };
}

function stripCodeFences(s) {
  return String(s ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseJsonLoose(raw) {
  const s = stripCodeFences(raw);
  try {
    const parsed = JSON.parse(s);
    if (typeof parsed === 'string') return JSON.parse(stripCodeFences(parsed));
    return parsed;
  } catch {
    // try extract first {...}
    const match = s.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeMode(mode) {
  const x = String(mode ?? '').trim().toUpperCase();
  if (x === 'ANSWER') return 'ALLOW';
  if (x === 'ALLOW') return 'ALLOW';
  if (x === 'CLARIFY') return 'CLARIFY';
  if (x === 'NO_ANSWER' || x === 'NOANSWER' || x === 'NO-ANSWER') return 'NO_ANSWER';
  return '';
}

function ensureArray(x) {
  if (Array.isArray(x)) return x;
  if (typeof x === 'string' && x.trim()) return [x.trim()];
  return [];
}

function extractTopSourceText(kbContext) {
  const s = String(kbContext ?? '');
  const m = s.match(/\[1\][^\n]*\n([\s\S]*?)(?:\n\n\[\d+\]|\s*$)/);
  return m ? String(m[1] ?? '').trim() : '';
}

function pickHits({ parsed, answerText, hits, topScore }) {
  const byN = new Map();
  const byId = new Map();

  for (const hit of hits) {
    if (hit?.n != null) byN.set(Number(hit.n), hit);
    if (hit?.chunk_id) byId.set(String(hit.chunk_id), hit);
  }

  const explicit = parsed?.sources;
  if (Array.isArray(explicit) && explicit.length) {
    const picked = [];
    for (const x of explicit) {
      if (typeof x === 'number' || /^\d+$/.test(String(x))) {
        const hit = byN.get(Number(x));
        if (hit) picked.push(hit);
      } else if (typeof x === 'string') {
        const hit = byId.get(String(x));
        if (hit) picked.push(hit);
      } else if (x && typeof x === 'object' && typeof x.chunk_id === 'string') {
        const hit = byId.get(String(x.chunk_id));
        if (hit) picked.push(hit);
      }
    }
    if (picked.length) return picked;
  }

  const cited = new Set();
  const re = /\[(\d+)\]/g;
  let m;
  while ((m = re.exec(String(answerText ?? ''))) !== null) cited.add(Number(m[1]));
  if (cited.size) return [...cited].map((n) => byN.get(n)).filter(Boolean);

  const ts = typeof topScore === 'number' ? topScore : Number(hits?.[0]?.score ?? 0);
  const minScore = ts * 0.9;
  return hits.filter((h) => Number(h?.score ?? 0) >= minScore);
}

function buildSources(pickedHits) {
  return [...pickedHits]
    .map((h, i) => ({
      n: h.n ?? i + 1,
      chunk_id: h.chunk_id ?? null,
      doc: h.doc ?? '',
      section: h.section ?? '',
      source_url: h.source_url ?? null,
      score: Number(h.score ?? 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function parseAnswer({ base, raw }) {
  const hits = base?.kb_sources ?? base?.retrieval?.hits ?? [];
  const topScore = Number(base?.retrieval?.top_score ?? hits?.[0]?.score ?? 0);

  const parsed = parseJsonLoose(raw);

  const gateMode = String(base?.decision?.mode ?? 'ALLOW').toUpperCase();

  let llmMode = normalizeMode(parsed?.mode);
  let llmReason = 'ok';
  if (!llmMode) {
    llmMode = 'CLARIFY';
    llmReason = 'llm_parse_error';
  }

  let finalMode = llmMode;
  let finalReason = llmReason;

  let answerText = '';
  let clarify = [];

  if (gateMode !== 'ALLOW') {
    finalMode = gateMode;
    finalReason = base?.decision?.reason ?? 'ok';
  } else if (llmMode === 'ALLOW') {
    answerText = String(parsed?.answer ?? '').trim();
  } else if (llmMode === 'CLARIFY') {
    clarify = ensureArray(parsed?.clarify);
  } else if (llmMode === 'NO_ANSWER') {
    answerText = String(parsed?.answer ?? '').trim();
  }

  // Override: if LLM said CLARIFY/NO_ANSWER but score is high and top chunk has usable text.
  const FORCE_ANSWER_SCORE = 0.5;
  if (
    gateMode === 'ALLOW' &&
    (llmMode === 'CLARIFY' || llmMode === 'NO_ANSWER') &&
    hits.length &&
    topScore >= FORCE_ANSWER_SCORE
  ) {
    const topText = extractTopSourceText(base?.kb_context_text);
    if (topText) {
      finalMode = 'ALLOW';
      finalReason = 'llm_override_high_score';
      answerText = topText;
      clarify = [];
    }
  }

  if (finalMode === 'ALLOW' && !answerText) {
    finalMode = 'CLARIFY';
    finalReason = 'llm_empty_answer';
    clarify = ['What exact access do you need (system/app) and for which role?'];
  }

  if (finalMode === 'CLARIFY' && (!Array.isArray(clarify) || clarify.length === 0)) {
    clarify = ['What exactly are you trying to do (feature/section), and in which system?'];
  }

  const pickedHits = finalMode === 'ALLOW' ? pickHits({ parsed, answerText, hits, topScore }) : [];
  const sources = finalMode === 'ALLOW' ? buildSources(pickedHits) : [];

  return {
    decision: { mode: finalMode, reason: finalReason },
    output: {
      answer_text: answerText,
      clarify,
      picked_hits: pickedHits,
      sources,
    },
  };
}

test('Gate Decide: ALLOW on high score', () => {
  const r = gateDecide({ topScore: 0.9, hitsCount: 3 });
  assert.equal(r.decision.mode, 'ALLOW');
  assert.equal(r.decision.reason, 'ok');
});

test('Gate Decide: CLARIFY on mid score', () => {
  const r = gateDecide({ topScore: 0.49, hitsCount: 3 });
  assert.equal(r.decision.mode, 'CLARIFY');
  assert.equal(r.decision.reason, 'low_confidence');
  assert.ok(r.output.answer.includes('What to clarify'));
});

test('Gate Decide: NO_ANSWER when no hits', () => {
  const r = gateDecide({ topScore: 0.99, hitsCount: 0 });
  assert.equal(r.decision.mode, 'NO_ANSWER');
  assert.equal(r.decision.reason, 'no_hits');
});

test('Parse: explicit sources -> pick strictly them', () => {
  const base = {
    decision: { mode: 'ALLOW', reason: 'ok' },
    retrieval: { top_score: 0.8 },
    kb_sources: [
      { n: 1, chunk_id: 'c1', doc: 'Doc1', section: 'S1', source_url: 'u1', score: 0.8 },
      { n: 2, chunk_id: 'c2', doc: 'Doc2', section: 'S2', source_url: 'u2', score: 0.79 },
      { n: 3, chunk_id: 'c3', doc: 'Doc3', section: 'S3', source_url: 'u3', score: 0.3 },
    ],
    kb_context_text: '[1] doc="Doc1" section="S1" score=0.800\nDoc1 text',
  };

  const raw = JSON.stringify({ mode: 'ALLOW', answer: 'Ok', sources: [2] });
  const out = parseAnswer({ base, raw });
  assert.equal(out.decision.mode, 'ALLOW');
  assert.deepEqual(out.output.sources.map((s) => s.chunk_id), ['c2']);
});

test('Parse: answer cites [1] -> pick only cited', () => {
  const base = {
    decision: { mode: 'ALLOW', reason: 'ok' },
    retrieval: { top_score: 0.8 },
    kb_sources: [
      { n: 1, chunk_id: 'c1', doc: 'Doc1', section: 'S1', source_url: 'u1', score: 0.8 },
      { n: 2, chunk_id: 'c2', doc: 'Doc2', section: 'S2', source_url: 'u2', score: 0.79 },
    ],
    kb_context_text: '[1] doc="Doc1" section="S1" score=0.800\nDoc1 text',
  };

  const raw = JSON.stringify({ mode: 'ALLOW', answer: 'See [1].', sources: [] });
  const out = parseAnswer({ base, raw });
  assert.equal(out.decision.mode, 'ALLOW');
  assert.deepEqual(out.output.sources.map((s) => s.chunk_id), ['c1']);
});

test('Parse: no sources, no [n] -> heuristic 0.9*top_score', () => {
  const base = {
    decision: { mode: 'ALLOW', reason: 'ok' },
    retrieval: { top_score: 1.0 },
    kb_sources: [
      { n: 1, chunk_id: 'c1', doc: 'Doc1', section: 'S1', source_url: 'u1', score: 1.0 },
      { n: 2, chunk_id: 'c2', doc: 'Doc2', section: 'S2', source_url: 'u2', score: 0.91 },
      { n: 3, chunk_id: 'c3', doc: 'Doc3', section: 'S3', source_url: 'u3', score: 0.5 },
    ],
    kb_context_text: '[1] doc="Doc1" section="S1" score=1.000\nDoc1 text',
  };

  const raw = JSON.stringify({ mode: 'ALLOW', answer: 'No citations here.' });
  const out = parseAnswer({ base, raw });
  assert.equal(out.decision.mode, 'ALLOW');
  assert.deepEqual(out.output.sources.map((s) => s.chunk_id), ['c1', 'c2']);
});

test('Parse: non-JSON -> llm_parse_error -> CLARIFY (safe)', () => {
  const base = {
    decision: { mode: 'ALLOW', reason: 'ok' },
    // Below override threshold (0.5) to ensure we don't auto-answer on parse error.
    retrieval: { top_score: 0.49 },
    kb_sources: [{ n: 1, chunk_id: 'c1', doc: 'Doc1', section: 'S1', source_url: 'u1', score: 0.49 }],
    kb_context_text: '[1] doc="Doc1" section="S1" score=0.800\nDoc1 text',
  };

  const out = parseAnswer({ base, raw: 'hello' });
  assert.equal(out.decision.mode, 'CLARIFY');
  assert.equal(out.decision.reason, 'llm_parse_error');
  assert.ok(out.output.clarify.length >= 1);
});

test('Parse: JSON in code fences -> parses', () => {
  const base = {
    decision: { mode: 'ALLOW', reason: 'ok' },
    retrieval: { top_score: 0.8 },
    kb_sources: [{ n: 1, chunk_id: 'c1', doc: 'Doc1', section: 'S1', source_url: 'u1', score: 0.8 }],
    kb_context_text: '[1] doc="Doc1" section="S1" score=0.800\nDoc1 text',
  };

  const raw = '```json\n{"mode":"ALLOW","answer":"Ok","sources":[1]}\n```';
  const out = parseAnswer({ base, raw });
  assert.equal(out.decision.mode, 'ALLOW');
  assert.deepEqual(out.output.sources.map((s) => s.chunk_id), ['c1']);
});

test('Parse: JSON string inside string -> parses', () => {
  const base = {
    decision: { mode: 'ALLOW', reason: 'ok' },
    retrieval: { top_score: 0.8 },
    kb_sources: [{ n: 1, chunk_id: 'c1', doc: 'Doc1', section: 'S1', source_url: 'u1', score: 0.8 }],
    kb_context_text: '[1] doc="Doc1" section="S1" score=0.800\nDoc1 text',
  };

  const raw = JSON.stringify('{"mode":"ALLOW","answer":"Ok","sources":[1]}');
  const out = parseAnswer({ base, raw });
  assert.equal(out.decision.mode, 'ALLOW');
  assert.deepEqual(out.output.sources.map((s) => s.chunk_id), ['c1']);
});

test('Parse: truncation/incomplete JSON -> CLARIFY (safe)', () => {
  const base = {
    decision: { mode: 'ALLOW', reason: 'ok' },
    // Below override threshold (0.5) to ensure we don't auto-answer on parse error.
    retrieval: { top_score: 0.49 },
    kb_sources: [{ n: 1, chunk_id: 'c1', doc: 'Doc1', section: 'S1', source_url: 'u1', score: 0.49 }],
    kb_context_text: '[1] doc="Doc1" section="S1" score=0.800\nDoc1 text',
  };

  const out = parseAnswer({ base, raw: '{"mode":"ALLOW","answer":"Ok"' });
  assert.equal(out.decision.mode, 'CLARIFY');
  assert.equal(out.decision.reason, 'llm_parse_error');
});

test('Parse: LLM CLARIFY but high score -> override to ALLOW with top chunk text', () => {
  const base = {
    decision: { mode: 'ALLOW', reason: 'ok' },
    retrieval: { top_score: 0.55 },
    kb_sources: [{ n: 1, chunk_id: 'c1', doc: 'Doc1', section: 'S1', source_url: 'u1', score: 0.55 }],
    kb_context_text: '[1] doc="Doc1" section="S1" score=0.550\nACCESS IS GRANTED IN 1 DAY.\n\n[2] doc="Doc2" section="S2" score=0.400\nOther',
  };

  const raw = JSON.stringify({ mode: 'CLARIFY', clarify: ['Which system?'] });
  const out = parseAnswer({ base, raw });
  assert.equal(out.decision.mode, 'ALLOW');
  assert.equal(out.decision.reason, 'llm_override_high_score');
  assert.equal(out.output.answer_text, 'ACCESS IS GRANTED IN 1 DAY.');
});

// TODO (Day 3 / platform): once implemented in workflows, replace with real e2e tests.
test.skip('External errors: DB insert fail -> user still gets answer', () => {});
test.skip('External errors: Telegram send fail -> retry/backoff then error state', () => {});
test.skip('Multi-turn: follow-up question uses history', () => {});
test.skip('Commands: /help, /sources, /debug', () => {});
test.skip('Security: prompt injection should not bypass KB-only rule', () => {});
