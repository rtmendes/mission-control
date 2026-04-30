import { queryAll, queryOne } from '@/lib/db';
import type { AgentHealth, Task } from '@/lib/types';

export type FlightRecorderEventKind =
  | 'task'
  | 'activity'
  | 'deliverable'
  | 'session'
  | 'chat'
  | 'event'
  | 'health'
  | 'checkpoint'
  | 'diagnostic';

export type FlightRecorderSeverity = 'info' | 'success' | 'warning' | 'danger';

export interface FlightRecorderActor {
  id?: string;
  name: string;
  avatar_emoji?: string;
  role?: string;
}

export interface FlightRecorderEvent {
  id: string;
  kind: FlightRecorderEventKind;
  severity: FlightRecorderSeverity;
  timestamp: string;
  title: string;
  detail?: string;
  actor?: FlightRecorderActor;
  metadata?: Record<string, unknown>;
}

export interface FlightRecorderGap {
  id: string;
  start_at: string;
  end_at: string;
  minutes: number;
  reason: string;
}

export interface TaskFlightRecorder {
  task: Pick<Task, 'id' | 'title' | 'status' | 'assigned_agent_id' | 'updated_at' | 'created_at'>;
  summary: {
    current_status: string;
    assigned_agent?: FlightRecorderActor;
    active_session_count: number;
    deliverable_count: number;
    activity_count: number;
    chat_message_count: number;
    latest_signal_at?: string;
    latest_signal_title?: string;
    chat_status: 'none' | 'answered' | 'awaiting_reply' | 'reply_not_surfaced';
    chat_diagnosis?: string;
    health_display_state?: string;
    health_reason?: string;
  };
  gaps: FlightRecorderGap[];
  events: FlightRecorderEvent[];
}

interface AgentRow {
  id: string;
  name: string;
  avatar_emoji?: string;
  role?: string;
}

interface ActivityRow {
  id: string;
  task_id: string;
  agent_id?: string;
  activity_type: string;
  message: string;
  metadata?: string | null;
  created_at: string;
  agent_name?: string;
  agent_avatar_emoji?: string;
  agent_role?: string;
}

interface DeliverableRow {
  id: string;
  deliverable_type: string;
  title: string;
  path?: string;
  description?: string;
  created_at: string;
}

interface SessionRow {
  id: string;
  agent_id?: string;
  openclaw_session_id: string;
  status: string;
  session_type: string;
  ended_at?: string;
  created_at: string;
  updated_at: string;
  agent_name?: string;
  agent_avatar_emoji?: string;
  agent_role?: string;
}

interface NoteRow {
  id: string;
  role: 'user' | 'assistant';
  status: string;
  mode: string;
  content: string;
  delivered_at?: string;
  created_at: string;
}

interface EventRow {
  id: string;
  type: string;
  agent_id?: string;
  message: string;
  metadata?: string | null;
  created_at: string;
  agent_name?: string;
  agent_avatar_emoji?: string;
  agent_role?: string;
}

interface CheckpointRow {
  id: string;
  agent_id?: string;
  checkpoint_type: string;
  state_summary: string;
  files_snapshot?: string | null;
  context_data?: string | null;
  created_at: string;
  agent_name?: string;
  agent_avatar_emoji?: string;
  agent_role?: string;
}

function parseTimestampMs(value?: string | null): number {
  if (!value) return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;

  // SQLite datetime('now') stores UTC as "YYYY-MM-DD HH:MM:SS" without a zone.
  // JS otherwise treats that form as local time, which makes age math wrong.
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = trimmed.includes('T')
    ? (hasTimezone ? trimmed : `${trimmed}Z`)
    : `${trimmed.replace(' ', 'T')}Z`;

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Date.parse(trimmed);
}

function normalizeTimestamp(value: string): string {
  const ms = parseTimestampMs(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : value;
}

function parseJsonObject(value?: string | Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return { raw: value };
  }
}

function actorFrom(row: { agent_id?: string; agent_name?: string; agent_avatar_emoji?: string; agent_role?: string }): FlightRecorderActor | undefined {
  if (!row.agent_id && !row.agent_name) return undefined;
  return {
    id: row.agent_id,
    name: row.agent_name || 'Agent',
    avatar_emoji: row.agent_avatar_emoji,
    role: row.agent_role,
  };
}

function activitySeverity(activity: ActivityRow): FlightRecorderSeverity {
  const message = activity.message.toLowerCase();
  if (message.includes('failed') || message.includes('blocked') || message.includes('stuck') || message.includes('zombie')) return 'danger';
  if (message.includes('stalled') || message.includes('warning') || message.includes('retry')) return 'warning';
  if (activity.activity_type === 'completed' || message.includes('complete') || message.includes('handoff')) return 'success';
  return 'info';
}

function noteTitle(note: NoteRow): string {
  if (note.role === 'assistant') return 'Agent replied in Chat';
  if (note.status === 'pending') return 'Operator message queued';
  if (note.status === 'delivered') return 'Operator message delivered';
  return 'Operator message read';
}

function trimDetail(value: string, max = 600): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function latestByTime<T extends { created_at?: string; delivered_at?: string; updated_at?: string }>(items: T[], getTime: (item: T) => string | undefined): T | undefined {
  return [...items].sort((a, b) => parseTimestampMs(getTime(b)) - parseTimestampMs(getTime(a)))[0];
}

function isCompletionLike(activity: ActivityRow): boolean {
  const msg = activity.message.toLowerCase();
  return activity.activity_type === 'completed'
    || msg.includes('task_complete')
    || msg.includes('test_pass')
    || msg.includes('verify_pass')
    || msg.includes('stage handoff')
    || msg.includes('task dispatched to');
}

function computeGaps(events: FlightRecorderEvent[]): FlightRecorderGap[] {
  const meaningful = events
    .filter(e => e.kind !== 'health' && e.kind !== 'diagnostic')
    .sort((a, b) => parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp));
  const gaps: FlightRecorderGap[] = [];

  for (let i = 1; i < meaningful.length; i++) {
    const prev = meaningful[i - 1];
    const next = meaningful[i];
    const minutes = Math.round((parseTimestampMs(next.timestamp) - parseTimestampMs(prev.timestamp)) / 60000);
    if (minutes >= 10) {
      gaps.push({
        id: `${prev.id}-${next.id}`,
        start_at: prev.timestamp,
        end_at: next.timestamp,
        minutes,
        reason: `No recorded Mission Control signal between “${prev.title}” and “${next.title}”.`,
      });
    }
  }

  return gaps;
}

export function buildTaskFlightRecorder(taskId: string): TaskFlightRecorder | null {
  const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return null;

  const assignedAgent = task.assigned_agent_id
    ? queryOne<AgentRow>('SELECT id, name, avatar_emoji, role FROM agents WHERE id = ?', [task.assigned_agent_id])
    : undefined;

  const activities = queryAll<ActivityRow>(
    `SELECT ta.*, a.name AS agent_name, a.avatar_emoji AS agent_avatar_emoji, a.role AS agent_role
     FROM task_activities ta
     LEFT JOIN agents a ON a.id = ta.agent_id
     WHERE ta.task_id = ?
     ORDER BY ta.created_at ASC`,
    [taskId]
  );

  const deliverables = queryAll<DeliverableRow>(
    `SELECT * FROM task_deliverables WHERE task_id = ? ORDER BY created_at ASC`,
    [taskId]
  );

  const sessions = queryAll<SessionRow>(
    `SELECT os.*, a.name AS agent_name, a.avatar_emoji AS agent_avatar_emoji, a.role AS agent_role
     FROM openclaw_sessions os
     LEFT JOIN agents a ON a.id = os.agent_id
     WHERE os.task_id = ?
        OR (os.agent_id = ? AND os.task_id IS NULL AND os.created_at >= ?)
     ORDER BY os.created_at ASC`,
    [taskId, task.assigned_agent_id || '', task.created_at]
  );

  const notes = queryAll<NoteRow>(
    `SELECT * FROM task_notes WHERE task_id = ? ORDER BY created_at ASC`,
    [taskId]
  );

  const events = queryAll<EventRow>(
    `SELECT e.*, a.name AS agent_name, a.avatar_emoji AS agent_avatar_emoji, a.role AS agent_role
     FROM events e
     LEFT JOIN agents a ON a.id = e.agent_id
     WHERE e.task_id = ?
     ORDER BY e.created_at ASC`,
    [taskId]
  );

  const checkpoints = queryAll<CheckpointRow>(
    `SELECT wc.*, a.name AS agent_name, a.avatar_emoji AS agent_avatar_emoji, a.role AS agent_role
     FROM work_checkpoints wc
     LEFT JOIN agents a ON a.id = wc.agent_id
     WHERE wc.task_id = ?
     ORDER BY wc.created_at ASC`,
    [taskId]
  );

  const health = task.assigned_agent_id
    ? queryOne<AgentHealth>('SELECT * FROM agent_health WHERE agent_id = ?', [task.assigned_agent_id])
    : undefined;
  const healthMetadata = parseJsonObject(health?.metadata as string | undefined);

  const timeline: FlightRecorderEvent[] = [];

  timeline.push({
    id: `task-created-${task.id}`,
    kind: 'task',
    severity: 'info',
    timestamp: normalizeTimestamp(task.created_at),
    title: 'Task created',
    detail: task.title,
    actor: assignedAgent ? { id: assignedAgent.id, name: assignedAgent.name, avatar_emoji: assignedAgent.avatar_emoji, role: assignedAgent.role } : undefined,
    metadata: { status: task.status, priority: task.priority },
  });

  for (const session of sessions) {
    timeline.push({
      id: `session-${session.id}`,
      kind: 'session',
      severity: session.status === 'active' ? 'success' : 'info',
      timestamp: normalizeTimestamp(session.created_at),
      title: session.status === 'active' ? 'OpenClaw session active' : `OpenClaw session ${session.status}`,
      detail: session.openclaw_session_id,
      actor: actorFrom(session),
      metadata: {
        session_type: session.session_type,
        status: session.status,
        updated_at: normalizeTimestamp(session.updated_at),
        ended_at: session.ended_at ? normalizeTimestamp(session.ended_at) : undefined,
      },
    });
  }

  for (const activity of activities) {
    timeline.push({
      id: `activity-${activity.id}`,
      kind: 'activity',
      severity: activitySeverity(activity),
      timestamp: normalizeTimestamp(activity.created_at),
      title: activity.activity_type.replace(/_/g, ' '),
      detail: activity.message,
      actor: actorFrom(activity),
      metadata: parseJsonObject(activity.metadata),
    });
  }

  for (const deliverable of deliverables) {
    timeline.push({
      id: `deliverable-${deliverable.id}`,
      kind: 'deliverable',
      severity: 'success',
      timestamp: normalizeTimestamp(deliverable.created_at),
      title: `Deliverable registered: ${deliverable.title}`,
      detail: deliverable.description || deliverable.path || deliverable.deliverable_type,
      metadata: {
        deliverable_type: deliverable.deliverable_type,
        path: deliverable.path,
      },
    });
  }

  for (const note of notes) {
    timeline.push({
      id: `chat-${note.id}`,
      kind: 'chat',
      severity: note.role === 'assistant' ? 'success' : note.status === 'pending' ? 'warning' : 'info',
      timestamp: normalizeTimestamp(note.created_at),
      title: noteTitle(note),
      detail: trimDetail(note.content),
      actor: note.role === 'assistant'
        ? { name: 'Agent' }
        : { name: 'Operator' },
      metadata: {
        mode: note.mode,
        status: note.status,
        delivered_at: note.delivered_at ? normalizeTimestamp(note.delivered_at) : undefined,
      },
    });
  }

  for (const event of events) {
    timeline.push({
      id: `event-${event.id}`,
      kind: 'event',
      severity: event.message.toLowerCase().includes('fail') ? 'danger' : 'info',
      timestamp: normalizeTimestamp(event.created_at),
      title: event.type.replace(/_/g, ' '),
      detail: event.message,
      actor: actorFrom(event),
      metadata: parseJsonObject(event.metadata),
    });
  }

  for (const checkpoint of checkpoints) {
    timeline.push({
      id: `checkpoint-${checkpoint.id}`,
      kind: 'checkpoint',
      severity: 'info',
      timestamp: normalizeTimestamp(checkpoint.created_at),
      title: `Checkpoint saved (${checkpoint.checkpoint_type})`,
      detail: checkpoint.state_summary,
      actor: actorFrom(checkpoint),
      metadata: {
        files_snapshot: parseJsonObject(checkpoint.files_snapshot),
        context_data: parseJsonObject(checkpoint.context_data),
      },
    });
  }

  if (health) {
    timeline.push({
      id: `health-${health.id}`,
      kind: 'health',
      severity: health.health_state === 'stuck' || health.health_state === 'zombie' ? 'danger' : health.health_state === 'stalled' ? 'warning' : 'info',
      timestamp: normalizeTimestamp(health.updated_at),
      title: `Health: ${String(healthMetadata?.display_state || health.health_state).replace(/_/g, ' ')}`,
      detail: typeof healthMetadata?.reason === 'string' ? healthMetadata.reason : undefined,
      actor: assignedAgent ? { id: assignedAgent.id, name: assignedAgent.name, avatar_emoji: assignedAgent.avatar_emoji, role: assignedAgent.role } : undefined,
      metadata: healthMetadata,
    });
  }

  const lastUserNote = latestByTime(notes.filter(n => n.role === 'user'), n => n.created_at);
  const lastAssistantAfterUser = lastUserNote
    ? notes.find(n => n.role === 'assistant' && parseTimestampMs(n.created_at) > parseTimestampMs(lastUserNote.created_at))
    : undefined;
  const completionAfterUser = lastUserNote
    ? latestByTime(activities.filter(a => isCompletionLike(a) && parseTimestampMs(a.created_at) > parseTimestampMs(lastUserNote.created_at)), a => a.created_at)
    : undefined;

  let chatStatus: TaskFlightRecorder['summary']['chat_status'] = 'none';
  let chatDiagnosis: string | undefined;

  if (lastUserNote) {
    if (lastAssistantAfterUser) {
      chatStatus = 'answered';
      chatDiagnosis = 'The latest operator chat message has an assistant response recorded.';
    } else if (completionAfterUser) {
      chatStatus = 'reply_not_surfaced';
      chatDiagnosis = `The operator message was delivered, then the agent emitted “${trimDetail(completionAfterUser.message, 160)}”, but no assistant chat note was recorded after the question.`;
      timeline.push({
        id: `diagnostic-chat-gap-${lastUserNote.id}`,
        kind: 'diagnostic',
        severity: 'warning',
        timestamp: normalizeTimestamp(completionAfterUser.created_at),
        title: 'Chat reply was not surfaced',
        detail: chatDiagnosis,
        actor: { name: 'Mission Control' },
        metadata: {
          last_user_note_id: lastUserNote.id,
          completion_activity_id: completionAfterUser.id,
        },
      });
    } else {
      chatStatus = 'awaiting_reply';
      chatDiagnosis = lastUserNote.status === 'pending'
        ? 'The latest operator chat message is still queued and has not been marked delivered.'
        : 'The latest operator chat message was delivered, but no assistant reply has been captured yet.';
    }
  }

  const sortedEvents = timeline.sort((a, b) => parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp));
  const latestSignal = [...sortedEvents].reverse().find(e => e.kind !== 'diagnostic' && e.kind !== 'health');

  return {
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      assigned_agent_id: task.assigned_agent_id,
      created_at: task.created_at,
      updated_at: task.updated_at,
    },
    summary: {
      current_status: task.status,
      assigned_agent: assignedAgent ? {
        id: assignedAgent.id,
        name: assignedAgent.name,
        avatar_emoji: assignedAgent.avatar_emoji,
        role: assignedAgent.role,
      } : undefined,
      active_session_count: sessions.filter(s => s.status === 'active').length,
      deliverable_count: deliverables.length,
      activity_count: activities.length,
      chat_message_count: notes.length,
      latest_signal_at: latestSignal?.timestamp,
      latest_signal_title: latestSignal?.title,
      chat_status: chatStatus,
      chat_diagnosis: chatDiagnosis,
      health_display_state: typeof healthMetadata?.display_state === 'string' ? healthMetadata.display_state : health?.health_state,
      health_reason: typeof healthMetadata?.reason === 'string' ? healthMetadata.reason : undefined,
    },
    gaps: computeGaps(sortedEvents),
    events: sortedEvents,
  };
}

export const __flightRecorderTestUtils = {
  parseTimestampMs,
  normalizeTimestamp,
};
