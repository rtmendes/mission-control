import test from 'node:test';
import assert from 'node:assert/strict';

import { normaliseModel } from './agent-catalog-sync';

test('normaliseModel only returns SQLite-safe strings or null', () => {
  assert.equal(normaliseModel('openai-codex/gpt-5.5'), 'openai-codex/gpt-5.5');
  assert.equal(normaliseModel({ primary: 'openai-codex/gpt-5.5', fallbacks: ['openai-codex/gpt-5.4'] }), 'openai-codex/gpt-5.5');
  assert.equal(normaliseModel({ fallbacks: ['openai-codex/gpt-5.4'] }), null);
  assert.equal(normaliseModel({ primary: { id: 'not-sqlite-safe' } } as unknown as Parameters<typeof normaliseModel>[0]), null);
});
