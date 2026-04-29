'use client';

import { useState } from 'react';
import { AlertTriangle, ExternalLink, Loader, RefreshCw } from 'lucide-react';

interface PrCheckItem {
  id: string;
  source: 'github_actions' | 'external';
  name: string;
  status: string;
  conclusion?: string;
  url?: string;
  retryable: boolean;
  classification: 'retryable' | 'repo_setup' | 'external' | 'not_retryable';
  message: string;
}

interface PrChecksSummary {
  prUrl: string;
  prNumber: number;
  headRef: string;
  checks: PrCheckItem[];
  repoReadiness?: {
    overallStatus: string;
    failingChecks: { id: string; title: string; message: string }[];
  };
}

export function PrCheckRecovery({ taskId }: { taskId: string }) {
  const [summary, setSummary] = useState<PrChecksSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function load() {
    setExpanded(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/pr-checks`);
      const data = await res.json().catch(() => ({ error: 'Failed to load PR checks' }));
      if (!res.ok) throw new Error(data.error || `Failed to load PR checks (${res.status})`);
      setSummary(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function retry() {
    setRetrying(true);
    setError(null);
    setLastResult(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/pr-checks/retry`, { method: 'POST' });
      const data = await res.json().catch(() => ({ error: 'Failed to retry PR checks' }));
      if (!res.ok) throw new Error(data.error || `Failed to retry PR checks (${res.status})`);
      const okCount = data.results?.filter((result: { ok: boolean }) => result.ok).length || 0;
      const failCount = data.results?.filter((result: { ok: boolean }) => !result.ok).length || 0;
      setLastResult(`${okCount} retry request${okCount === 1 ? '' : 's'} accepted${failCount ? `, ${failCount} failed` : ''}.`);
      setSummary(data.summary);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        onClick={expanded ? () => setExpanded(false) : load}
        className="min-h-8 px-2.5 rounded-lg border border-mc-border bg-mc-bg text-xs text-mc-text-secondary hover:text-mc-text hover:border-mc-accent"
      >
        {expanded ? 'Hide checks' : 'PR checks'}
      </button>

      {expanded && (
        <div className="mt-3 rounded-lg border border-mc-border bg-mc-bg p-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-mc-text-secondary">
              <Loader className="w-3.5 h-3.5 animate-spin" />
              Loading checks...
            </div>
          ) : error ? (
            <div className="text-xs text-red-300">{error}</div>
          ) : summary ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-mc-text-secondary">
                  PR #{summary.prNumber} <span className="font-mono">{summary.headRef}</span>
                </div>
                <div className="flex gap-2">
                  <a
                    href={summary.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-8 px-2.5 rounded-lg border border-mc-border text-xs text-mc-text-secondary hover:text-mc-text flex items-center gap-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open
                  </a>
                  <button
                    onClick={retry}
                    disabled={retrying || summary.checks.length === 0}
                    className="min-h-8 px-2.5 rounded-lg bg-mc-accent text-xs font-medium text-white hover:bg-mc-accent/90 disabled:opacity-50 flex items-center gap-1"
                  >
                    {retrying ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Retry failed
                  </button>
                </div>
              </div>

              {lastResult && <div className="text-xs text-green-300">{lastResult}</div>}

              {summary.repoReadiness?.failingChecks?.length ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-red-300">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Repo setup is blocking this PR
                  </div>
                  <div className="mt-1 space-y-1">
                    {summary.repoReadiness.failingChecks.slice(0, 4).map(check => (
                      <div key={check.id} className="text-xs text-mc-text-secondary">{check.title}: {check.message}</div>
                    ))}
                  </div>
                </div>
              ) : null}

              {summary.checks.length === 0 ? (
                <div className="text-xs text-green-300">No failed PR checks found.</div>
              ) : (
                <div className="space-y-2">
                  {summary.checks.map(check => (
                    <div key={check.id} className="rounded-lg border border-mc-border bg-mc-bg-secondary px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-medium text-mc-text">{check.name}</div>
                          <div className="mt-0.5 text-xs text-mc-text-secondary">{check.message}</div>
                        </div>
                        <span className="text-[11px] uppercase tracking-wider text-red-300">{check.conclusion || check.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
