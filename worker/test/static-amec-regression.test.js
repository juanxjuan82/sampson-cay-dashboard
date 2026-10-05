import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

test('admin index exposes the PR tracker import and recovery cards', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="amec-tracker-input"[^>]+accept="\.xlsx,\.xls,\.csv"/);
  assert.match(html, />Media Narrative</);
  assert.match(html, />Key Moments</);
  assert.match(html, /articleTracker:\s*\{/);
});

test('saved client report contains narrative cards without an exposed upload control', async () => {
  const html = await readFile(path.join(root, 'report.html'), 'utf8');
  assert.match(html, />Media Narrative</);
  assert.match(html, />Key Moments</);
  assert.doesNotMatch(html, /id="amec-tracker-input"/);
});

test('future client exports hide admin-only tracker controls', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /#amec-tracker-upload[^\{]*\{\s*display:\s*none\s*!important/);
  assert.match(html, /buildTrackerCardsHTML\(articleTracker\)/);
});
