import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const dashboardFiles = [
  new URL('../../index.html', import.meta.url),
  new URL('../../report.html', import.meta.url),
];

for (const file of dashboardFiles) {
  test(`${file.pathname.split('/').pop()} exports monitored text as script-safe JSON`, () => {
    const html = readFileSync(file, 'utf8');
    const helperSource = html.match(/function serializeForInlineScript\(value\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(helperSource, 'script-safe serializer is present');
    assert.match(html, /const dataJSON = serializeForInlineScript\(data\);/);

    const serialize = Function(`${helperSource}; return serializeForInlineScript;`)();
    const hostileTitle = '</script><script>globalThis.compromised=true</script>\u2028next\u2029line';
    const serialized = serialize({strategyEvidence: {leadingClaims: [{examples: [hostileTitle]}]}});

    assert.equal(serialized.includes('</script>'), false);
    assert.equal(serialized.includes('<script>'), false);
    assert.equal(serialized.includes('\u2028'), false);
    assert.equal(serialized.includes('\u2029'), false);
    assert.equal(JSON.parse(serialized).strategyEvidence.leadingClaims[0].examples[0], hostileTitle);
  });

  test(`${file.pathname.split('/').pop()} keeps legacy performance copy out of public narrative`, () => {
    const html = readFileSync(file, 'utf8');
    const helperSource = html.match(/function migrateEditableOverrides\(overrides = \{\}\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(helperSource, 'legacy migration helper is present');
    const migrate = Function(`${helperSource}; return migrateEditableOverrides;`)();
    const migrated = migrate({
      'whats-working': 'Community evidence is strongest.',
      'whats-needs-attention': 'Economy needs more specific proof.',
    });

    assert.match(migrated['goal-progress'], /Community evidence is strongest/);
    assert.match(migrated['goal-progress'], /Economy needs more specific proof/);
    assert.doesNotMatch(migrated['public-narrative'], /Economy needs more specific proof/);
    assert.match(migrated['public-narrative'], /No monitored public-claims evidence/);
  });
}
