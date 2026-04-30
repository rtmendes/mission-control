import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { run } from './db';
import { collectRecentLogs } from './error-reporting';

test('collectRecentLogs includes failed research and ideation cycles using started_at timestamps', () => {
  const suffix = randomUUID();
  const productId = `product-error-report-test-${suffix}`;
  const startedAt = '2026-04-28T23:10:00.000Z';

  run(
    `INSERT INTO products (id, workspace_id, name, description, created_at, updated_at)
     VALUES (?, 'default', ?, '', ?, ?)`,
    [productId, 'Error Report Test Product', startedAt, startedAt]
  );

  run(
    `INSERT INTO research_cycles (id, product_id, status, current_phase, error_message, started_at)
     VALUES (?, ?, 'failed', 'llm_submitted', ?, ?)`,
    [`research-error-report-test-${suffix}`, productId, 'research failed', startedAt]
  );

  run(
    `INSERT INTO ideation_cycles (id, product_id, status, current_phase, error_message, started_at)
     VALUES (?, ?, 'failed', 'llm_polling', ?, ?)`,
    [`ideation-error-report-test-${suffix}`, productId, 'ideation failed', startedAt]
  );

  const logs = collectRecentLogs({ productId });

  assert.match(logs, /Product: Error Report Test Product/);
  assert.match(logs, /--- Failed Research Cycles ---/);
  assert.match(logs, /research failed/);
  assert.match(logs, /--- Failed Ideation Cycles ---/);
  assert.match(logs, /ideation failed/);
  assert.match(logs, new RegExp(startedAt));
});
