'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader, RefreshCw, ShieldAlert, SlidersHorizontal, Wrench } from 'lucide-react';

type RepoReadinessStatus = 'pass' | 'warning' | 'fail' | 'info';

interface RepoReadinessAction {
  id: string;
  kind: 'set_workflow_permissions_write' | 'set_actions_enabled_all' | 'set_secret' | 'set_variable' | 'open_url';
  label: string;
  targetName?: string;
  requiresInput?: boolean;
  inputType?: 'secret' | 'text';
  href?: string;
}

interface RepoReadinessCheck {
  id: string;
  category: string;
  title: string;
  status: RepoReadinessStatus;
  severity: 'info' | 'warning' | 'blocking';
  message: string;
  details?: Record<string, unknown>;
  actions?: RepoReadinessAction[];
}

interface RepoReadinessResult {
  productId: string;
  repoUrl?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  overallStatus: 'ready' | 'warning' | 'blocked';
  checkedAt: string;
  checks: RepoReadinessCheck[];
}

interface RepoSetupPanelProps {
  productId: string;
}

interface PendingFix {
  action: RepoReadinessAction;
  value: string;
}

function statusClass(status: RepoReadinessStatus) {
  if (status === 'pass') return 'border-green-500/25 bg-green-500/10 text-green-300';
  if (status === 'warning') return 'border-amber-500/25 bg-amber-500/10 text-amber-300';
  if (status === 'fail') return 'border-red-500/25 bg-red-500/10 text-red-300';
  return 'border-mc-border bg-mc-bg-secondary text-mc-text-secondary';
}

function StatusIcon({ status }: { status: RepoReadinessStatus }) {
  if (status === 'pass') return <CheckCircle2 className="w-4 h-4 text-green-400" />;
  if (status === 'fail') return <ShieldAlert className="w-4 h-4 text-red-400" />;
  if (status === 'warning') return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  return <SlidersHorizontal className="w-4 h-4 text-mc-text-secondary" />;
}

export function RepoSetupPanel({ productId }: RepoSetupPanelProps) {
  const [readiness, setReadiness] = useState<RepoReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingFix, setPendingFix] = useState<PendingFix | null>(null);

  const loadReadiness = useCallback(async (method: 'GET' | 'POST' = 'GET') => {
    setError(null);
    if (method === 'POST') setRunning(true);
    try {
      const res = await fetch(`/api/products/${productId}/repo-readiness`, { method });
      const data = await res.json().catch(() => ({ error: 'Repo setup check failed' }));
      if (!res.ok) throw new Error(data.error || `Repo setup check failed (${res.status})`);
      setReadiness(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      setRunning(false);
    }
  }, [productId]);

  useEffect(() => {
    loadReadiness();
  }, [loadReadiness]);

  async function applyFix(action: RepoReadinessAction, value?: string) {
    if (action.kind === 'open_url' && action.href) {
      window.open(action.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action.requiresInput && value === undefined) {
      setPendingFix({ action, value: '' });
      return;
    }

    setFixing(action.id);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/repo-readiness/fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: action.kind,
          targetName: action.targetName,
          value,
        }),
      });
      const data = await res.json().catch(() => ({ error: 'Fix failed' }));
      if (!res.ok) throw new Error(data.error || `Fix failed (${res.status})`);
      setReadiness(data);
      setPendingFix(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFixing(null);
    }
  }

  if (loading) {
    return <div className="text-mc-text-secondary animate-pulse">Loading repo setup...</div>;
  }

  const blockedCount = readiness?.checks.filter(check => check.status === 'fail').length || 0;
  const warningCount = readiness?.checks.filter(check => check.status === 'warning').length || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold text-mc-text">Repo Setup</h3>
          {readiness?.repoUrl && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mc-text-secondary">
              <span>{readiness.owner}/{readiness.repo}</span>
              {readiness.branch && <span className="font-mono">branch:{readiness.branch}</span>}
              <span>{new Date(readiness.checkedAt).toLocaleString()}</span>
            </div>
          )}
        </div>
        <button
          onClick={() => loadReadiness('POST')}
          disabled={running}
          className="min-h-10 px-3 rounded-lg bg-mc-bg-secondary border border-mc-border text-sm text-mc-text hover:border-mc-accent flex items-center gap-2 disabled:opacity-50"
        >
          {running ? <Loader className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {running ? 'Checking...' : 'Run checks'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      )}

      {readiness && (
        <div className={`rounded-lg border px-4 py-3 ${readiness.overallStatus === 'ready' ? 'border-green-500/25 bg-green-500/10' : readiness.overallStatus === 'blocked' ? 'border-red-500/25 bg-red-500/10' : 'border-amber-500/25 bg-amber-500/10'}`}>
          <div className="flex items-center gap-2">
            <StatusIcon status={readiness.overallStatus === 'ready' ? 'pass' : readiness.overallStatus === 'blocked' ? 'fail' : 'warning'} />
            <span className="text-sm font-medium text-mc-text">
              {readiness.overallStatus === 'ready' ? 'Ready for Autopilot PRs' : readiness.overallStatus === 'blocked' ? `${blockedCount} blocking setup issue${blockedCount === 1 ? '' : 's'}` : `${warningCount} setup warning${warningCount === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {readiness?.checks.map(item => (
          <div key={item.id} className={`rounded-lg border p-4 ${statusClass(item.status)}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusIcon status={item.status} />
                  <h4 className="text-sm font-medium text-mc-text">{item.title}</h4>
                  {item.severity === 'blocking' && item.status === 'fail' && (
                    <span className="text-[11px] uppercase tracking-wider text-red-300">blocking</span>
                  )}
                </div>
                <p className="mt-1 text-sm text-mc-text-secondary">{item.message}</p>
              </div>
              {item.actions && item.actions.length > 0 && (
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {item.actions.map(action => (
                    <button
                      key={action.id}
                      onClick={() => applyFix(action)}
                      disabled={fixing === action.id}
                      className="min-h-9 px-3 rounded-lg bg-mc-bg border border-mc-border text-xs text-mc-text hover:border-mc-accent flex items-center gap-2 disabled:opacity-50"
                    >
                      {fixing === action.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : action.kind === 'open_url' ? <ExternalLink className="w-3.5 h-3.5" /> : <Wrench className="w-3.5 h-3.5" />}
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {pendingFix && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setPendingFix(null)} />
          <div className="relative w-full max-w-md rounded-lg border border-mc-border bg-mc-bg-secondary p-5 shadow-xl">
            <h3 className="text-base font-semibold text-mc-text">{pendingFix.action.label}</h3>
            <p className="mt-1 text-sm text-mc-text-secondary">{pendingFix.action.targetName}</p>
            <input
              type={pendingFix.action.inputType === 'secret' ? 'password' : 'text'}
              value={pendingFix.value}
              onChange={e => setPendingFix({ ...pendingFix, value: e.target.value })}
              className="mt-4 w-full rounded-lg border border-mc-border bg-mc-bg px-3 py-2 text-sm text-mc-text focus:border-mc-accent focus:outline-none"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPendingFix(null)}
                className="min-h-9 px-3 rounded-lg text-sm text-mc-text-secondary hover:text-mc-text"
              >
                Cancel
              </button>
              <button
                onClick={() => applyFix(pendingFix.action, pendingFix.value)}
                disabled={!pendingFix.value || fixing === pendingFix.action.id}
                className="min-h-9 px-3 rounded-lg bg-mc-accent text-sm font-medium text-white hover:bg-mc-accent/90 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
