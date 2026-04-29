import test, { before } from 'node:test';
import assert from 'node:assert/strict';

type RunFn = typeof import('./db').run;
type CheckAgentHealthFn = typeof import('./agent-health').checkAgentHealth;
type EvaluateAgentHealthFn = typeof import('./agent-health').evaluateAgentHealth;

let run: RunFn;
let checkAgentHealth: CheckAgentHealthFn;
let evaluateAgentHealth: EvaluateAgentHealthFn;

before(async () => {
  process.env.DATABASE_PATH = `.tmp/agent-health-${process.pid}.db`;
  ({ run } = await import('./db'));
  ({ checkAgentHealth, evaluateAgentHealth } = await import('./agent-health'));
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

function seedAgentTask(opts: { agentId?: string; taskId?: string; updatedMinutesAgo?: number; status?: string } = {}) {
  seedWorkspace();
  const agentId = opts.agentId || crypto.randomUUID();
  const taskId = opts.taskId || crypto.randomUUID();
  const updatedAt = minutesAgo(opts.updatedMinutesAgo ?? 10);

  run(
    `INSERT INTO agents (id, name, role, avatar_emoji, status, workspace_id, source, created_at, updated_at)
     VALUES (?, 'Builder', 'builder', '🤖', 'working', 'default', 'local', ?, ?)`,
    [agentId, minutesAgo(30), updatedAt]
  );

  run(
    `INSERT INTO tasks (id, title, status, priority, assigned_agent_id, workspace_id, business_id, created_at, updated_at)
     VALUES (?, 'Autonomous build', ?, 'normal', ?, 'default', 'default', ?, ?)`,
    [taskId, opts.status || 'in_progress', agentId, minutesAgo(30), updatedAt]
  );

  return { agentId, taskId };
}

function seedActiveSession(agentId: string, taskId: string, minutesOld = 10) {
  run(
    `INSERT INTO openclaw_sessions (id, agent_id, openclaw_session_id, status, session_type, task_id, created_at, updated_at)
     VALUES (?, ?, ?, 'active', 'persistent', ?, ?, ?)`,
    [crypto.randomUUID(), agentId, `session-${taskId}`, taskId, minutesAgo(minutesOld), minutesAgo(minutesOld)]
  );
}

test('active agent with a quiet session is working silently, not stalled', () => {
  const { agentId, taskId } = seedAgentTask({ updatedMinutesAgo: 12 });
  seedActiveSession(agentId, taskId, 12);
  run(
    `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
     VALUES (?, ?, ?, 'updated', 'Started implementation', ?)`,
    [crypto.randomUUID(), taskId, agentId, minutesAgo(12)]
  );

  const evaluation = evaluateAgentHealth(agentId);
  assert.equal(evaluation.health_state, 'working');
  assert.equal(evaluation.display_state, 'working_silently');
  assert.equal(checkAgentHealth(agentId), 'working');
});

test('completion after an unanswered operator question is surfaced as completed_not_surfaced', () => {
  const { agentId, taskId } = seedAgentTask({ updatedMinutesAgo: 8, status: 'testing' });
  seedActiveSession(agentId, taskId, 8);
  run(
    `INSERT INTO task_notes (id, task_id, content, mode, role, status, delivered_at, created_at)
     VALUES (?, ?, 'what happened?', 'direct', 'user', 'delivered', ?, ?)`,
    [crypto.randomUUID(), taskId, minutesAgo(6), minutesAgo(6)]
  );
  run(
    `INSERT INTO task_activities (id, task_id, agent_id, activity_type, message, created_at)
     VALUES (?, ?, ?, 'completed', 'TASK_COMPLETE: Built the package and handed off to testing', ?)`,
    [crypto.randomUUID(), taskId, agentId, minutesAgo(4)]
  );

  const evaluation = evaluateAgentHealth(agentId);
  assert.equal(evaluation.health_state, 'working');
  assert.equal(evaluation.display_state, 'completed_not_surfaced');
  assert.equal(evaluation.signals.completion_after_latest_user, true);
  assert.equal(evaluation.signals.assistant_reply_after_latest_user, false);
});

test('delivered operator question without reply becomes overdue after grace window', () => {
  const { agentId, taskId } = seedAgentTask({ updatedMinutesAgo: 35 });
  seedActiveSession(agentId, taskId, 35);
  run(
    `INSERT INTO task_notes (id, task_id, content, mode, role, status, delivered_at, created_at)
     VALUES (?, ?, 'are you stuck?', 'direct', 'user', 'delivered', ?, ?)`,
    [crypto.randomUUID(), taskId, minutesAgo(35), minutesAgo(35)]
  );

  const evaluation = evaluateAgentHealth(agentId);
  assert.equal(evaluation.health_state, 'stalled');
  assert.equal(evaluation.display_state, 'needs_attention');
  assert.equal(evaluation.display_label, 'Chat reply overdue');
});

test('active task without an active session is no_heartbeat/zombie', () => {
  const { agentId } = seedAgentTask({ updatedMinutesAgo: 3 });

  const evaluation = evaluateAgentHealth(agentId);
  assert.equal(evaluation.health_state, 'zombie');
  assert.equal(evaluation.display_state, 'no_heartbeat');
  assert.equal(evaluation.severity, 'danger');
});
