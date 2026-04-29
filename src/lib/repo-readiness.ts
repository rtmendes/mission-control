import { v4 as uuidv4 } from 'uuid';
import { queryAll, queryOne, run } from '@/lib/db';
import { preflightRepoAccess } from '@/lib/repo-preflight';
import { ghApi, ghSecretSet, parseGitHubRepoUrl, summarizeCliError } from '@/lib/github-cli';
import type { Product } from '@/lib/types';

export type RepoReadinessStatus = 'pass' | 'warning' | 'fail' | 'info';
export type RepoReadinessActionKind =
  | 'set_workflow_permissions_write'
  | 'set_actions_enabled_all'
  | 'set_secret'
  | 'set_variable'
  | 'open_url';

export interface RepoReadinessAction {
  id: string;
  kind: RepoReadinessActionKind;
  label: string;
  targetName?: string;
  requiresInput?: boolean;
  inputType?: 'secret' | 'text';
  href?: string;
}

export interface RepoReadinessCheck {
  id: string;
  category: 'access' | 'branch' | 'pull_requests' | 'actions' | 'workflows' | 'checks';
  title: string;
  status: RepoReadinessStatus;
  severity: 'info' | 'warning' | 'blocking';
  message: string;
  details?: Record<string, unknown>;
  actions?: RepoReadinessAction[];
}

export interface RepoReadinessResult {
  productId: string;
  repoUrl?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  private?: boolean;
  overallStatus: 'ready' | 'warning' | 'blocked';
  checkedAt: string;
  checks: RepoReadinessCheck[];
}

interface GitHubRepoResponse {
  private?: boolean;
  html_url?: string;
  default_branch?: string;
  permissions?: Record<string, boolean>;
}

interface ActionsPermissionsResponse {
  enabled?: boolean;
  allowed_actions?: string;
}

interface WorkflowPermissionsResponse {
  default_workflow_permissions?: 'read' | 'write';
  can_approve_pull_request_reviews?: boolean;
}

interface WorkflowDirectoryItem {
  type: string;
  name: string;
  path: string;
}

interface WorkflowContentResponse {
  content?: string;
  encoding?: string;
  name?: string;
  path?: string;
}

interface SecretsResponse {
  secrets?: { name: string }[];
}

interface VariablesResponse {
  variables?: { name: string }[];
}

interface CachedRepoReadinessRow {
  product_id: string;
  check_id: string;
  status: RepoReadinessStatus;
  severity: 'info' | 'warning' | 'blocking';
  category: RepoReadinessCheck['category'];
  title: string;
  message: string;
  details?: string;
  actions?: string;
  last_checked_at: string;
}

function encodePath(path: string): string {
  return path.split('/').map(part => encodeURIComponent(part)).join('/');
}

function collectMatches(text: string, regex: RegExp): string[] {
  const values = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) values.add(match[1]);
  }
  return Array.from(values).sort();
}

function statusFromChecks(checks: RepoReadinessCheck[]): RepoReadinessResult['overallStatus'] {
  if (checks.some(check => check.status === 'fail' && check.severity === 'blocking')) return 'blocked';
  if (checks.some(check => check.status === 'warning' || check.status === 'fail')) return 'warning';
  return 'ready';
}

function check(
  id: string,
  category: RepoReadinessCheck['category'],
  title: string,
  status: RepoReadinessStatus,
  severity: RepoReadinessCheck['severity'],
  message: string,
  options: Pick<RepoReadinessCheck, 'details' | 'actions'> = {}
): RepoReadinessCheck {
  return { id, category, title, status, severity, message, ...options };
}

export function getCachedRepoReadiness(productId: string): RepoReadinessResult | null {
  const product = queryOne<Product>('SELECT * FROM products WHERE id = ?', [productId]);
  if (!product) return null;

  const rows = queryAll<CachedRepoReadinessRow>(
    'SELECT * FROM repo_readiness_checks WHERE product_id = ? ORDER BY category, title',
    [productId]
  );

  if (rows.length === 0) return null;

  const repo = parseGitHubRepoUrl(product.repo_url);
  const checkedAt = rows.reduce((latest, row) => row.last_checked_at > latest ? row.last_checked_at : latest, rows[0].last_checked_at);
  const checks = rows.map(row => ({
    id: row.check_id,
    category: row.category,
    title: row.title,
    status: row.status,
    severity: row.severity,
    message: row.message,
    details: row.details ? JSON.parse(row.details) : undefined,
    actions: row.actions ? JSON.parse(row.actions) : undefined,
  }));

  return {
    productId,
    repoUrl: product.repo_url,
    owner: repo?.owner,
    repo: repo?.repo,
    branch: product.default_branch || undefined,
    overallStatus: statusFromChecks(checks),
    checkedAt,
    checks,
  };
}

function saveRepoReadiness(result: RepoReadinessResult): void {
  run('DELETE FROM repo_readiness_checks WHERE product_id = ?', [result.productId]);
  for (const item of result.checks) {
    run(
      `INSERT INTO repo_readiness_checks
       (id, product_id, check_id, category, status, severity, title, message, details, actions, last_checked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        result.productId,
        item.id,
        item.category,
        item.status,
        item.severity,
        item.title,
        item.message,
        item.details ? JSON.stringify(item.details) : null,
        item.actions ? JSON.stringify(item.actions) : null,
        result.checkedAt,
        result.checkedAt,
        result.checkedAt,
      ]
    );
  }
}

async function readWorkflowFiles(owner: string, repo: string, branch: string): Promise<{ path: string; name: string; content: string }[]> {
  const items = ghApi<WorkflowDirectoryItem[]>(
    `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/.github/workflows?ref=${encodeURIComponent(branch)}`
  );
  const workflowItems = (items || []).filter(item => item.type === 'file' && /\.(ya?ml)$/i.test(item.name));

  return workflowItems.map(item => {
    const content = ghApi<WorkflowContentResponse>(
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(item.path)}?ref=${encodeURIComponent(branch)}`
    );
    const decoded = content.content && content.encoding === 'base64'
      ? Buffer.from(content.content.replace(/\s/g, ''), 'base64').toString('utf-8')
      : '';
    return { path: item.path, name: item.name, content: decoded };
  });
}

export async function scanRepoReadiness(productId: string): Promise<RepoReadinessResult> {
  const product = queryOne<Product>('SELECT * FROM products WHERE id = ?', [productId]);
  if (!product) throw new Error('Product not found');

  const checkedAt = new Date().toISOString();
  const checks: RepoReadinessCheck[] = [];
  const repoUrl = product.repo_url || undefined;
  const branch = product.default_branch || 'main';
  const parsed = parseGitHubRepoUrl(repoUrl);

  if (!repoUrl) {
    checks.push(check('repo_url', 'access', 'Repository URL', 'info', 'info', 'No repository is configured for this product.'));
    const result = { productId, repoUrl, branch, overallStatus: statusFromChecks(checks), checkedAt, checks };
    saveRepoReadiness(result);
    return result;
  }

  const preflight = preflightRepoAccess(repoUrl, branch);
  checks.push(check(
    'git_access',
    'access',
    'Git access',
    preflight.ok ? 'pass' : 'fail',
    'blocking',
    preflight.ok ? preflight.message : preflight.error || preflight.message,
    { details: { defaultBranch: preflight.defaultBranch, requestedBranch: branch, authHint: preflight.authHint } }
  ));

  if (!parsed) {
    checks.push(check('github_url', 'access', 'GitHub repository', 'fail', 'blocking', 'Repo Setup currently supports GitHub repositories.'));
    const result = { productId, repoUrl, branch, overallStatus: statusFromChecks(checks), checkedAt, checks };
    saveRepoReadiness(result);
    return result;
  }

  let repoInfo: GitHubRepoResponse | undefined;
  try {
    repoInfo = ghApi<GitHubRepoResponse>(`repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`);
    checks.push(check('github_api_access', 'access', 'GitHub API access', 'pass', 'blocking', 'GitHub API access is confirmed.'));
  } catch (error) {
    checks.push(check(
      'github_api_access',
      'access',
      'GitHub API access',
      'fail',
      'blocking',
      summarizeCliError(error),
      { actions: [{ id: 'open_repo_settings', kind: 'open_url', label: 'Open GitHub', href: `https://github.com/${parsed.fullName}` }] }
    ));
  }

  if (preflight.access === 'confirmed') {
    checks.push(check(
      'default_branch',
      'branch',
      'Default branch',
      preflight.branchExists ? 'pass' : 'fail',
      'blocking',
      preflight.branchExists
        ? `Branch ${branch} exists.`
        : `Branch ${branch} was not found${preflight.defaultBranch ? `; detected ${preflight.defaultBranch}` : ''}.`,
      { details: { defaultBranch: preflight.defaultBranch, resolvedBranch: preflight.resolvedBranch } }
    ));
  }

  try {
    ghApi(`repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/pulls?state=open&per_page=1`);
    checks.push(check('pull_request_access', 'pull_requests', 'Pull request access', 'pass', 'blocking', 'Pull request metadata is readable.'));
  } catch (error) {
    checks.push(check('pull_request_access', 'pull_requests', 'Pull request access', 'fail', 'blocking', summarizeCliError(error)));
  }

  let actionsPermissions: ActionsPermissionsResponse | undefined;
  try {
    actionsPermissions = ghApi<ActionsPermissionsResponse>(`repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/actions/permissions`);
    checks.push(check(
      'actions_enabled',
      'actions',
      'GitHub Actions',
      actionsPermissions.enabled ? 'pass' : 'fail',
      'blocking',
      actionsPermissions.enabled ? 'GitHub Actions are enabled.' : 'GitHub Actions are disabled for this repository.',
      actionsPermissions.enabled ? undefined : {
        actions: [{ id: 'set_actions_enabled_all', kind: 'set_actions_enabled_all', label: 'Enable Actions' }],
      }
    ));
  } catch (error) {
    checks.push(check('actions_enabled', 'actions', 'GitHub Actions', 'warning', 'warning', summarizeCliError(error)));
  }

  try {
    const workflowPerms = ghApi<WorkflowPermissionsResponse>(`repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/actions/permissions/workflow`);
    const writeEnabled = workflowPerms.default_workflow_permissions === 'write';
    checks.push(check(
      'workflow_token_permissions',
      'actions',
      'Workflow token permissions',
      writeEnabled ? 'pass' : 'fail',
      'blocking',
      writeEnabled
        ? 'Workflow token default is read/write.'
        : 'Workflow token default is read-only, which can block PR metadata and changed-file checks.',
      writeEnabled ? { details: workflowPerms as unknown as Record<string, unknown> } : {
        details: workflowPerms as unknown as Record<string, unknown>,
        actions: [{ id: 'set_workflow_permissions_write', kind: 'set_workflow_permissions_write', label: 'Set read/write' }],
      }
    ));
  } catch (error) {
    checks.push(check('workflow_token_permissions', 'actions', 'Workflow token permissions', 'warning', 'warning', summarizeCliError(error)));
  }

  let workflows: { path: string; name: string; content: string }[] = [];
  try {
    workflows = await readWorkflowFiles(parsed.owner, parsed.repo, branch);
    checks.push(check(
      'workflow_files',
      'workflows',
      'Workflow files',
      workflows.length > 0 ? 'pass' : 'warning',
      workflows.length > 0 ? 'info' : 'warning',
      workflows.length > 0 ? `${workflows.length} workflow file${workflows.length === 1 ? '' : 's'} found.` : 'No GitHub Actions workflows were found.',
      {
        details: {
          count: workflows.length,
          pullRequestWorkflowCount: workflows.filter(workflow => /\bpull_request(_target)?\b/.test(workflow.content)).length,
          files: workflows.map(w => w.path),
        },
      }
    ));
  } catch (error) {
    checks.push(check('workflow_files', 'workflows', 'Workflow files', 'warning', 'warning', summarizeCliError(error)));
  }

  if (workflows.length > 0) {
    const prWorkflows = workflows.filter(workflow => /\bpull_request(_target)?\b/.test(workflow.content));
    const workflowText = prWorkflows.map(workflow => workflow.content).join('\n');
    const requiredSecrets = collectMatches(workflowText, /\bsecrets\.([A-Z0-9_]+)/g)
      .filter(name => name !== 'GITHUB_TOKEN');
    const requiredVariables = collectMatches(workflowText, /\bvars\.([A-Z0-9_]+)/g);

    try {
      const existingSecrets = ghApi<SecretsResponse>(`repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/actions/secrets`);
      const existingNames = new Set((existingSecrets.secrets || []).map(secret => secret.name));
      const missing = requiredSecrets.filter(name => !existingNames.has(name));
      checks.push(check(
        'workflow_required_secrets',
        'workflows',
        'Workflow secrets',
        missing.length === 0 ? 'pass' : 'fail',
        missing.length === 0 ? 'info' : 'blocking',
        missing.length === 0 ? 'All PR workflow secrets exist.' : `${missing.length} PR workflow secret${missing.length === 1 ? '' : 's'} missing.`,
        {
          details: { required: requiredSecrets, missing, workflowFiles: prWorkflows.map(workflow => workflow.path) },
          actions: missing.map(name => ({
            id: `set_secret_${name}`,
            kind: 'set_secret',
            label: `Add ${name}`,
            targetName: name,
            requiresInput: true,
            inputType: 'secret',
          })),
        }
      ));
    } catch (error) {
      checks.push(check('workflow_required_secrets', 'workflows', 'Workflow secrets', 'warning', 'warning', summarizeCliError(error)));
    }

    try {
      const existingVariables = ghApi<VariablesResponse>(`repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/actions/variables`);
      const existingNames = new Set((existingVariables.variables || []).map(variable => variable.name));
      const missing = requiredVariables.filter(name => !existingNames.has(name));
      checks.push(check(
        'workflow_required_variables',
        'workflows',
        'Workflow variables',
        missing.length === 0 ? 'pass' : 'fail',
        missing.length === 0 ? 'info' : 'blocking',
        missing.length === 0 ? 'All PR workflow variables exist.' : `${missing.length} PR workflow variable${missing.length === 1 ? '' : 's'} missing.`,
        {
          details: { required: requiredVariables, missing, workflowFiles: prWorkflows.map(workflow => workflow.path) },
          actions: missing.map(name => ({
            id: `set_variable_${name}`,
            kind: 'set_variable',
            label: `Add ${name}`,
            targetName: name,
            requiresInput: true,
            inputType: 'text',
          })),
        }
      ));
    } catch (error) {
      checks.push(check('workflow_required_variables', 'workflows', 'Workflow variables', 'warning', 'warning', summarizeCliError(error)));
    }

    const reusableWorkflows = collectMatches(workflowText, /uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/\.github\/workflows\//g);
    if (reusableWorkflows.length > 0) {
      checks.push(check(
        'reusable_workflows',
        'workflows',
        'Reusable workflows',
        'info',
        'info',
        `${reusableWorkflows.length} external reusable workflow source${reusableWorkflows.length === 1 ? '' : 's'} referenced.`,
        { details: { repositories: reusableWorkflows } }
      ));
    }
  }

  const result: RepoReadinessResult = {
    productId,
    repoUrl,
    owner: parsed.owner,
    repo: parsed.repo,
    branch,
    private: repoInfo?.private,
    overallStatus: statusFromChecks(checks),
    checkedAt,
    checks,
  };
  saveRepoReadiness(result);
  return result;
}

function assertGitHubRepo(product: Product) {
  const repo = parseGitHubRepoUrl(product.repo_url);
  if (!repo) throw new Error('Product does not have a GitHub repository configured');
  return repo;
}

function validateRepoSettingName(name: string): string {
  const normalized = name.trim().toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(normalized)) {
    throw new Error('Invalid GitHub Actions setting name');
  }
  return normalized;
}

export async function applyRepoReadinessFix(
  productId: string,
  input: { kind: RepoReadinessActionKind; targetName?: string; value?: string }
): Promise<RepoReadinessResult> {
  const product = queryOne<Product>('SELECT * FROM products WHERE id = ?', [productId]);
  if (!product) throw new Error('Product not found');
  const repo = assertGitHubRepo(product);
  const owner = encodeURIComponent(repo.owner);
  const name = encodeURIComponent(repo.repo);

  if (input.kind === 'set_workflow_permissions_write') {
    ghApi(`repos/${owner}/${name}/actions/permissions/workflow`, {
      method: 'PUT',
      body: {
        default_workflow_permissions: 'write',
        can_approve_pull_request_reviews: false,
      },
    });
  } else if (input.kind === 'set_actions_enabled_all') {
    ghApi(`repos/${owner}/${name}/actions/permissions`, {
      method: 'PUT',
      body: {
        enabled: true,
        allowed_actions: 'all',
      },
    });
  } else if (input.kind === 'set_secret') {
    const settingName = validateRepoSettingName(input.targetName || '');
    if (!input.value) throw new Error(`Value is required for ${settingName}`);
    ghSecretSet(repo.fullName, settingName, input.value);
  } else if (input.kind === 'set_variable') {
    const settingName = validateRepoSettingName(input.targetName || '');
    if (input.value === undefined || input.value === '') throw new Error(`Value is required for ${settingName}`);
    try {
      ghApi(`repos/${owner}/${name}/actions/variables/${encodeURIComponent(settingName)}`, {
        method: 'PATCH',
        body: { name: settingName, value: input.value },
      });
    } catch {
      ghApi(`repos/${owner}/${name}/actions/variables`, {
        method: 'POST',
        body: { name: settingName, value: input.value },
      });
    }
  } else {
    throw new Error(`Unsupported fix action: ${input.kind}`);
  }

  return scanRepoReadiness(productId);
}
