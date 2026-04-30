import test, { before } from 'node:test';
import assert from 'node:assert/strict';

type RunFn = typeof import('./db').run;
type BuildTaskFlightRecorderFn = typeof import('./task-flight-recorder').buildTaskFlightRecorder;

let run: RunFn;
let buildTaskFlightRecorder: BuildTaskFlightRecorderFn;

before(async () => {
  process.env.DATABASE_PATH = `.tmp/task-flight-recorder-${process.pid}.db`;
  ({ run } = await import('./db'));
  ({ buildTaskFlightRecorder } = await import('./task-flight-recorder'));
});

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60000).toISOString();
}

function seedWorkspace() {
  run(
    `INSERT OR IGNORE INTO workspaces (id, name, slug, icon, created_at, updated_at)
     VALUES ('default', 'Default', 'default', '📁', ?, ?)`,
    [minutesAgo(0), minutesAgo(0)]
  );
}

test('flight recorder diagnoses delivered chat with completion but no surfaced assistant reply', () => {
  seedWorkspace();
  const agentId = crypto.randomUUID();
  const taskId = crypto.randomUUID();

  run(
    `INSERT INTO agents (id, name, role, avatar_emoji, status, workspace_id, source, created_at, updated_at)
     VALUES (?, 'Product Mapper', 'mapper', '🧭', 'working', 'default', 'local', ?, ?)`,
    [agentId, minutesAgo(30), minutesAgo(2)]
  );
  run(
    `INSERT INTO tasks (id, title, status, priority, assigned_agent_id, workspace_id, business_id, created_at, updated_at)
     VALUES (?, 'Create a carbon copy of Bloom', 'testing', 'normal', ?, 'default', 'default', ?, ?)`,
    [taskId, agentId, minutesAgo(30), minutesAgo(2)]
  );
  run(
    `INSERT INTO openclaw_sessions (id, agent_id, openclaw_session_id, status, session_type, task_id, created_at, updated_at)
     VALUES (?, ?, ?, 'active', 'persistent', ?, ?, ?)`,
    [crypto.randomUUID(), agentId, `mission-control-product-mapper-${taskId}`, taskId, minutesAgo(20), minutesAgo(20)]
  );
  run(
    `INSERT INTO task_notes (id, task_id, content, mode, role, status, delivered_at, created_at)
     VALUES (?, ?, 'why did the agent stall?', 'direct', 'user', 'delivered', ?, ?)`,
    [crypto.randomUUID(), taskId, minutesAgo(8), minutesAgo(8)]
  );
  run(
    `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
     VALUES (?, ?, ?, 'completed', 'TASK_COMPLETE: Built the discovery package and handed off to Tester Agent', ?)`,
    [crypto.randomUUID(), taskId, agentId, minutesAgo(4)]
  );
  run(
    `INSERT INTO task_deliverables (id, task_id, deliverable_type, title, path, created_at)
     VALUES (?, ?, 'file', 'PRD.md', '/tmp/PRD.md', ?)`,
    [crypto.randomUUID(), taskId, minutesAgo(3)]
  );

  const recorder = buildTaskFlightRecorder(taskId);

  assert.ok(recorder);
  assert.equal(recorder.summary.chat_status, 'reply_not_surfaced');
  assert.equal(recorder.summary.deliverable_count, 1);
  assert.ok(recorder.summary.chat_diagnosis?.includes('no assistant chat note'));
  assert.ok(recorder.events.some(event => event.kind === 'diagnostic' && event.title === 'Chat reply was not surfaced'));
});
