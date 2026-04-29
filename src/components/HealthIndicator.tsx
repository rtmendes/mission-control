'use client';

import type { AgentHealthState } from '@/lib/types';

interface HealthIndicatorProps {
  state: AgentHealthState;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

const healthConfig: Record<AgentHealthState, { color: string; pulse: boolean; label: string }> = {
  idle: { color: 'bg-gray-400', pulse: false, label: 'Idle' },
  working: { color: 'bg-green-400', pulse: false, label: 'Working' },
  stalled: { color: 'bg-yellow-400', pulse: true, label: 'Stalled' },
  stuck: { color: 'bg-red-400', pulse: true, label: 'Stuck' },
  zombie: { color: 'bg-red-500', pulse: true, label: 'Zombie' },
  offline: { color: 'bg-gray-600', pulse: false, label: 'Offline' },
  active_recently: { color: 'bg-green-400', pulse: false, label: 'Active' },
  working_silently: { color: 'bg-cyan-400', pulse: false, label: 'Working silently' },
  awaiting_reply: { color: 'bg-blue-400', pulse: true, label: 'Awaiting reply' },
  waiting_for_delivery: { color: 'bg-amber-400', pulse: true, label: 'Chat queued' },
  completed_not_surfaced: { color: 'bg-amber-400', pulse: true, label: 'Completion hidden' },
  needs_attention: { color: 'bg-yellow-400', pulse: true, label: 'Needs attention' },
  no_heartbeat: { color: 'bg-red-500', pulse: true, label: 'No session' },
  genuinely_stuck: { color: 'bg-red-500', pulse: true, label: 'Stuck' },
  blocked: { color: 'bg-red-400', pulse: true, label: 'Blocked' },
};

export function HealthIndicator({ state, size = 'sm', showLabel = false }: HealthIndicatorProps) {
  const config = healthConfig[state] || healthConfig.idle;
  const dotSize = size === 'sm' ? 'w-2 h-2' : 'w-3 h-3';

  return (
    <div className="flex items-center gap-1.5">
      <div className={`${dotSize} rounded-full ${config.color} ${config.pulse ? 'animate-pulse' : ''}`} />
      {showLabel && (
        <span className="text-[10px] text-mc-text-secondary uppercase">{config.label}</span>
      )}
    </div>
  );
}
