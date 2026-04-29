'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCircle, CircleDot, Clock, FileText, HeartPulse, MessageSquare, Package, Radio, RefreshCw, Route, Zap } from 'lucide-react';

type Severity = 'info' | 'success' | 'warning' | 'danger';
type EventKind = 'task' | 'activity' | 'deliverable' | 'session' | 'chat' | 'event' | 'health' | 'checkpoint' | 'diagnostic';

interface FlightRecorderActor {
  id?: string;
  name: string;
  avatar_emoji?: string;
  role?: string;
}

interface FlightRecorderEvent {
  id: string;
  kind: EventKind;
  severity: Severity;
  timestamp: string;
  title: string;
  detail?: string;
  actor?: FlightRecorderActor;
  metadata?: Record<string, unknown>;
}

interface FlightRecorderGap {
  id: string;
  start_at: string;
  end_at: string;
  minutes: number;
  reason: string;
}

interface FlightRecorderPayload {
  task: {
    id: string;
    title: string;
    status: string;
    assigned_agent_id?: string | null;
    created_at: string;
    updated_at: string;
  };
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

interface TaskFlightRecorderProps {
  taskId: string;
}

const severityStyles: Record<Severity, string> = {
  info: 'border-mc-border bg-mc-bg',
  success: 'border-green-500/25 bg-green-500/10',
  warning: 'border-amber-500/30 bg-amber-500/10',
  danger: 'border-red-500/30 bg-red-500/10',
};

const severityText: Record<Severity, string> = {
  info: 'text-mc-text-secondary',
  success: 'text-green-300',
  warning: 'text-amber-300',
  danger: 'text-red-300',
};

function eventIcon(kind: EventKind, severity: Severity) {
  const className = `w-4 h-4 ${severityText[severity]}`;
  switch (kind) {
    case 'session': return <Radio className={className} />;
    case 'chat': return <MessageSquare className={className} />;
    case 'deliverable': return <Package className={className} />;
    case 'health': return <HeartPulse className={className} />;
    case 'checkpoint': return <FileText className={className} />;
    case 'diagnostic': return <AlertTriangle className={className} />;
    case 'activity': return severity === 'success' ? <CheckCircle className={className} /> : <Zap className={className} />;
    default: return <CircleDot className={className} />;
  }
}

function formatTime(value?: string) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${formatDistanceToNow(date, { addSuffix: true })} · ${date.toLocaleTimeString()}`;
}

function chatBadge(status: FlightRecorderPayload['summary']['chat_status']) {
  switch (status) {
    case 'answered': return { label: 'Chat answered', className: 'bg-green-500/15 text-green-300 border-green-500/25' };
    case 'awaiting_reply': return { label: 'Awaiting reply', className: 'bg-blue-500/15 text-blue-300 border-blue-500/25' };
    case 'reply_not_surfaced': return { label: 'Reply not surfaced', className: 'bg-amber-500/15 text-amber-300 border-amber-500/25' };
    default: return { label: 'No chat yet', className: 'bg-mc-bg-tertiary text-mc-text-secondary border-mc-border' };
  }
}

export function TaskFlightRecorder({ taskId }: TaskFlightRecorderProps) {
  const [data, setData] = useState<FlightRecorderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);
      const res = await fetch(`/api/tasks/${taskId}/flight-recorder`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed to load flight recorder' }));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load flight recorder');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load(true);
    const interval = setInterval(() => load(false), 5000);
    return () => clearInterval(interval);
  }, [load]);

  const newestFirst = useMemo(() => data ? [...data.events].reverse() : [], [data]);
  const badge = data ? chatBadge(data.summary.chat_status) : null;

  if (loading) {
    return <div className="text-mc-text-secondary text-sm py-8 text-center">Loading flight recorder...</div>;
  }

  if (error) {
    return (
      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-300">
        {error}
      </div>
    );
  }

  if (!data) {
    return <div className="text-mc-text-secondary text-sm py-8 text-center">No flight recorder data.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="p-3 rounded-lg bg-mc-bg border border-mc-border">
          <div className="text-[10px] uppercase text-mc-text-secondary">Status</div>
          <div className="text-sm font-medium text-mc-text capitalize">{data.summary.current_status.replace(/_/g, ' ')}</div>
        </div>
        <div className="p-3 rounded-lg bg-mc-bg border border-mc-border">
          <div className="text-[10px] uppercase text-mc-text-secondary">Agent</div>
          <div className="text-sm font-medium text-mc-text truncate">
            {data.summary.assigned_agent?.avatar_emoji} {data.summary.assigned_agent?.name || 'Unassigned'}
          </div>
        </div>
        <div className="p-3 rounded-lg bg-mc-bg border border-mc-border">
          <div className="text-[10px] uppercase text-mc-text-secondary">Sessions</div>
          <div className="text-sm font-medium text-mc-text">{data.summary.active_session_count} active</div>
        </div>
        <div className="p-3 rounded-lg bg-mc-bg border border-mc-border">
          <div className="text-[10px] uppercase text-mc-text-secondary">Artifacts</div>
          <div className="text-sm font-medium text-mc-text">{data.summary.deliverable_count} deliverables</div>
        </div>
      </div>

      <div className="p-3 rounded-lg bg-mc-bg border border-mc-border space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Route className="w-4 h-4 text-mc-accent" />
          <span className="font-medium text-sm text-mc-text">What Mission Control knows</span>
          {badge && <span className={`ml-auto text-xs border px-2 py-1 rounded-full ${badge.className}`}>{badge.label}</span>}
        </div>
        <div className="text-sm text-mc-text-secondary space-y-1">
          {data.summary.health_display_state && (
            <p><span className="text-mc-text">Health:</span> {data.summary.health_display_state.replace(/_/g, ' ')}</p>
          )}
          {data.summary.health_reason && <p>{data.summary.health_reason}</p>}
          {data.summary.chat_diagnosis && <p>{data.summary.chat_diagnosis}</p>}
          {data.summary.latest_signal_at && (
            <p><span className="text-mc-text">Latest signal:</span> {data.summary.latest_signal_title} ({formatTime(data.summary.latest_signal_at)})</p>
          )}
        </div>
      </div>

      {data.gaps.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25">
          <div className="flex items-center gap-2 mb-2 text-amber-300 text-sm font-medium">
            <Clock className="w-4 h-4" /> Quiet windows
          </div>
          <div className="space-y-2">
            {data.gaps.slice(-3).reverse().map(gap => (
              <div key={gap.id} className="text-xs text-amber-100/80">
                <span className="font-medium text-amber-200">{gap.minutes} min:</span> {gap.reason}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs font-medium uppercase text-mc-text-secondary">Timeline</div>
        {newestFirst.map(event => (
          <div key={event.id} className={`p-3 rounded-lg border ${severityStyles[event.severity]}`}>
            <div className="flex items-start gap-3">
              <div className="mt-0.5">{eventIcon(event.kind, event.severity)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-mc-text capitalize">{event.title}</span>
                  <span className="text-[10px] uppercase text-mc-text-secondary">{event.kind}</span>
                  <span className="ml-auto text-xs text-mc-text-secondary">{formatTime(event.timestamp)}</span>
                </div>
                {event.actor && (
                  <div className="text-xs text-mc-text-secondary mt-0.5">
                    {event.actor.avatar_emoji} {event.actor.name}{event.actor.role ? ` · ${event.actor.role}` : ''}
                  </div>
                )}
                {event.detail && (
                  <div className="text-sm text-mc-text-secondary whitespace-pre-wrap break-words mt-2">
                    {event.detail}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => load(true)}
        className="w-full min-h-11 flex items-center justify-center gap-2 text-xs text-mc-text-secondary hover:text-mc-text border border-mc-border rounded-lg"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Refresh flight recorder
      </button>
    </div>
  );
}
