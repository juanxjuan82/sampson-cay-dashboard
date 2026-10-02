import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker, {buildNarrativeEvidence} from '../src/index.js';

function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_monitor.sql', import.meta.url), 'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0005_redirect_history.sql', import.meta.url), 'utf8'));
  const DB = {
    prepare(query) {
      let params = [];
      const stmt = sql.prepare(query);
      return {
        bind(...values) { params = values; return this; },
        async all() { return {results: stmt.all(...params)}; },
      };
    },
  };
  sql.prepare('INSERT INTO sources(id,label,url) VALUES(?,?,?)').run('sea', 'Save Exuma Alliance', 'https://example.com/sea');
  sql.prepare('INSERT INTO sources(id,label,url) VALUES(?,?,?)').run('press', 'Bahamian Press', 'https://example.com/press');
  const insert = sql.prepare('INSERT INTO items(id,source_id,url,title,first_seen,changed_at,last_seen,content_hash,text,tags) VALUES(?,?,?,?,?,?,?,?,?,?)');
  return {DB, insert};
}

test('narrative status remains baseline-building until fourteen days of coverage', async () => {
  const {DB, insert} = setup();
  insert.run('a'.repeat(64), 'sea', 'https://example.com/a', 'Consultation claim', '2026-10-01T12:00:00.000Z', '2026-10-01', '2026-10-01', 'h1', 'text', JSON.stringify([{theme: 'Consultation'}]));
  const evidence = await buildNarrativeEvidence(DB, new Date('2026-10-02T12:00:00.000Z'));
  assert.equal(evidence.status, 'Baseline building');
  assert.equal(evidence.current7Days.items, 1);
  assert.equal(evidence.leadingClaims[0].theme, 'Consultation');
});

test('narrative status uses deterministic seven-day counts and distinct sources', async () => {
  const {DB, insert} = setup();
  const add = (id, source, seen, theme) => insert.run(id.repeat(64), source, `https://example.com/${id}`, `${theme} claim`, seen, seen, seen, id, 'text', JSON.stringify([{theme}]));
  add('a', 'sea', '2026-09-13T12:00:00.000Z', 'Consultation');
  add('b', 'sea', '2026-09-21T12:00:00.000Z', 'Consultation');
  add('c', 'sea', '2026-09-27T12:00:00.000Z', 'Consultation');
  add('d', 'press', '2026-09-29T12:00:00.000Z', 'Consultation');
  add('e', 'press', '2026-10-01T12:00:00.000Z', 'Environment');
  const evidence = await buildNarrativeEvidence(DB, new Date('2026-10-02T12:00:00.000Z'));
  assert.equal(evidence.status, 'Rising');
  assert.deepEqual(evidence.current7Days, {items: 3, distinctSources: 2});
  assert.deepEqual(evidence.previous7Days, {items: 1, distinctSources: 1});
  assert.equal(evidence.leadingClaims[0].theme, 'Consultation');
  assert.equal(evidence.leadingClaims[0].currentDistinctSources, 2);
});

test('summary keeps private coaching separate and returns deterministic narrative evidence', async () => {
  const {DB, insert} = setup();
  insert.run('f'.repeat(64), 'sea', 'https://example.com/f', 'Consultation claim', new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), 'hf', 'text', JSON.stringify([{theme: 'Consultation'}]));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const payload = JSON.parse(options.body);
    const input = JSON.parse(payload.input);
    assert.equal(input.accountContext, 'Approved goals');
    assert.equal(input.editorGuidance, 'The client will accept a measured response.');
    assert.equal(input.deterministicNarrativeEvidence.status, 'Baseline building');
    assert.match(payload.instructions, /Grade 8 reader/);
    return Response.json({model: 'test-model', output_text: JSON.stringify({
      executiveRead: 'Clear read.',
      goalProgress: 'Clear progress.',
      publicNarrative: 'Clear narrative.',
      socialDirection: 'Publish 1–2 feed posts per week.',
      historicalPrecedent: 'Use the consultation record.',
    })});
  };
  try {
    const request = new Request('https://worker.example/summary', {
      method: 'POST',
      headers: {Origin: 'https://example.com', Authorization: 'Bearer dashboard-secret', 'Content-Type': 'application/json'},
      body: JSON.stringify({evidence: {overall: {posts: 1}}, accountContext: 'Approved goals', editorGuidance: 'The client will accept a measured response.'}),
    });
    const response = await worker.fetch(request, {DB, OPENAI_API_KEY: 'openai-secret', DASHBOARD_AI_TOKEN: 'dashboard-secret', OPENAI_MODEL: 'test-model', ALLOWED_ORIGINS: 'https://example.com'});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.summary.socialDirection, 'Publish 1–2 feed posts per week.');
    assert.equal(body.narrativeEvidence.leadingClaims[0].theme, 'Consultation');
    assert.equal(JSON.stringify(body).includes('The client will accept'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
