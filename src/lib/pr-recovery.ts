import { queryOne } from '@/lib/db';
import { ghApi, parseGitHubPrUrl, summarizeCliError } from '@/lib/github-cli';
import { getCachedRepoReadiness, scanRepoReadiness } from '@/lib/repo-readiness';
import type { Task } from '@/lib/types';

export interface PrCheckItem {
  id: string;
  source: 'github_actions' | 'external';
  name: string;
  status: string;
  conclusion?: string;
  url?: string;
  runId?: number;
  checkRunId?: number;
  retryable: boolean;
  classification: 'retryable' | 'repo_setup' | 'external' | 'not_retryable';
  message: string;
}

export interface PrChecksSummary {
  taskId: string;
  prUrl: string;
  owner: string;
  repo: string;
  prNumber: number;
  headRef: string;
  headSha: string;
  baseRef: string;
  checks: PrCheckItem[];
  repoReadiness?: {
    overallStatus: string;
    failingChecks: { id: string; title: string; message: string }[];
  };
}
export interface PrRetryResult {
  attemptedAt: string;
  results: { id: string; name: string; ok: boolean; message: string }[];
  summary: PrChecksSummary;
}

interface PullRequestResponse {
  number: number;
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string };
}

interface WorkflowRunsResponse {
  workflow_runs?: {
    id: number;
    name: string;
    display_title?: string;
    status: string;
    conclusion?: string;
    html_url?: string;
    head_sha: string;
    event: string;
  }[];
}

interface CheckRunsResponse {
  check_runs?: {
    id: number;
    name: string;
    status: string;
    conclusion?: string;
    details_url?: string;
    app?: { slug?: string };
  }[];
}

function actionableConclusion(conclusion?: string): boolean {
  return Boolean(conclusion && !['success', 'neutral', 'skipped'].includes(conclusion));
}

function classifyActionRun(run: { conclusion?: string; name: string }): Pick<PrCheckItem, 'classification' | 'retryable' | 'message'> {
  if (run.conclusion === 'startup_failure') {
    return {
      classification: 'repo_setup',
      retryable: true,
      message: 'Workflow failed before creating jobs. A rerun will be attempted, but this usually needs repo setup.',
    };
  }
  return {
    classification: 'retryable',
    retryable: true,
    message: 'Failed GitHub Actions run can be retried.',
  };
}

function taskRepoReadinessHint(task: Task): PrChecksSummary['repoReadiness'] | undefined {
  if (!task.product_id) return undefined;
  const readiness = getCachedRepoReadiness(task.product_id);
  if (!readiness) return undefined;
  const failingChecks = readiness.checks
    .filter(check => check.status === 'fail')
    .map(check => ({ id: check.id, title: check.title, message: check.message }));
  return { overallStatus: readiness.overallStatus, failingChecks };
}

export async function getTaskPrChecks(taskId: string): Promise<PrChecksSummary> {
  const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Task not found');
  const pr = parseGitHubPrUrl(task.pr_url);
  if (!pr) throw new Error('Task does not have a GitHub pull request URL');

  const pull = ghApi<PullRequestResponse>(`repos/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/pulls/${pr.prNumber}`);
  const runs = ghApi<WorkflowRunsResponse>(
    `repos/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/actions/runs?branch=${encodeURIComponent(pull.head.ref)}&per_page=50`
  );
  const checkRuns = ghApi<CheckRunsResponse>(
    `repos/${encodeURIComponent(pr.owner)}/${encodeURIComponent(pr.repo)}/commits/${encodeURIComponent(pull.head.sha)}/check-runs`
  );

  const actionRuns = (runs.workflow_runs || [])
    .filter(run => run.head_sha === pull.head.sha && actionableConclusion(run.conclusion))
    .map(run => {
      const classification = classifyActionRun(run);
      return {
        id: `run-${run.id}`,
        source: 'github_actions' as const,
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        url: run.html_url,
        runId: run.id,
        ...classification,
      };
    });

  const externalChecks = (checkRuns.check_runs || [])
    .filter(checkRun => checkRun.app?.slug !== 'github-actions' && actionableConclusion(checkRun.conclusion))
    .map(checkRun => ({
      id: `check-${checkRun.id}`,
      source: 'external' as const,
      name: checkRun.name,
      status: checkRun.status,
      conclusion: checkRun.conclusion,
      url: checkRun.details_url,
      checkRunId: checkRun.id,
      retryable: true,
      classification: 'external' as const,
      message: 'External check can be rerequested once; persistent failures must be fixed in that provider.',
    }));

  return {
    taskId,
    prUrl: pull.html_url,
    owner: pr.owner,
    repo: pr.repo,
    prNumber: pr.prNumber,
    headRef: pull.head.ref,
    headSha: pull.head.sha,
    baseRef: pull.base.ref,
    checks: [...actionRuns, ...externalChecks],
    repoReadiness: taskRepoReadinessHint(task),
  };
}

export async function retryTaskPrChecks(taskId: string): Promise<PrRetryResult> {
  const task = queryOne<Task>('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) throw new Error('Task not found');
  if (task.product_id) {
    await scanRepoReadiness(task.product_id).catch(() => undefined);
  }

  const summary = await getTaskPrChecks(taskId);
  const results: PrRetryResult['results'] = [];
  const owner = encodeURIComponent(summary.owner);
  const repo = encodeURIComponent(summary.repo);

  for (const item of summary.checks) {
    if (!item.retryable) continue;
    try {
      if (item.source === 'github_actions' && item.runId) {
        const endpoint = item.conclusion === 'startup_failure'
          ? `repos/${owner}/${repo}/actions/runs/${item.runId}/rerun`
          : `repos/${owner}/${repo}/actions/runs/${item.runId}/rerun-failed-jobs`;
        ghApi(endpoint, { method: 'POST' });
        results.push({ id: item.id, name: item.name, ok: true, message: 'Rerun requested.' });
      } else if (item.source === 'external' && item.checkRunId) {
        ghApi(`repos/${owner}/${repo}/check-runs/${item.checkRunId}/rerequest`, { method: 'POST' });
        results.push({ id: item.id, name: item.name, ok: true, message: 'Check rerequested.' });
      }
    } catch (error) {
      results.push({ id: item.id, name: item.name, ok: false, message: summarizeCliError(error) });
    }
  }

  return {
    attemptedAt: new Date().toISOString(),
    results,
    summary: await getTaskPrChecks(taskId),
  };
}
