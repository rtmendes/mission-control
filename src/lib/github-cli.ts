import { execFileSync } from 'child_process';

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  fullName: string;
}

interface ExecFailure extends Error {
  status?: number;
  stdout?: Buffer | string;
  stderr?: Buffer | string;
}

function outputSnippet(value: unknown): string | undefined {
  if (!value) return undefined;
  const text = Buffer.isBuffer(value) ? value.toString('utf-8') : String(value);
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, 2000) : undefined;
}

export function summarizeCliError(error: unknown): string {
  const err = error as ExecFailure;
  return outputSnippet(err.stderr) || outputSnippet(err.stdout) || err.message || 'GitHub command failed';
}

export function parseGitHubRepoUrl(repoUrl?: string | null): GitHubRepoRef | null {
  if (!repoUrl) return null;
  const trimmed = repoUrl.trim();

  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    const owner = sshMatch[1];
    const repo = sshMatch[2].replace(/\.git$/i, '');
    return { owner, repo, fullName: `${owner}/${repo}` };
  }

  const sshUrlMatch = trimmed.match(/^ssh:\/\/git@github\.com\/([^/\s]+)\/(.+?)(?:\.git)?$/i);
  if (sshUrlMatch) {
    const owner = sshUrlMatch[1];
    const repo = sshUrlMatch[2].replace(/\.git$/i, '');
    return { owner, repo, fullName: `${owner}/${repo}` };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.toLowerCase() !== 'github.com') return null;
    const [owner, repoWithSuffix] = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (!owner || !repoWithSuffix) return null;
    const repo = repoWithSuffix.replace(/\.git$/i, '');
    return { owner, repo, fullName: `${owner}/${repo}` };
  } catch {
    return null;
  }
}

export function parseGitHubPrUrl(prUrl?: string | null): (GitHubRepoRef & { prNumber: number }) | null {
  if (!prUrl) return null;
  try {
    const parsed = new URL(prUrl.trim());
    if (parsed.hostname.toLowerCase() !== 'github.com') return null;
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 4 || parts[2] !== 'pull') return null;
    const prNumber = Number(parts[3]);
    if (!parts[0] || !parts[1] || !Number.isInteger(prNumber)) return null;
    return {
      owner: parts[0],
      repo: parts[1].replace(/\.git$/i, ''),
      fullName: `${parts[0]}/${parts[1].replace(/\.git$/i, '')}`,
      prNumber,
    };
  } catch {
    return null;
  }
}

export function ghApi<T = unknown>(path: string, options: { method?: string; body?: unknown; timeoutMs?: number } = {}): T {
  const method = options.method || 'GET';
  const args = [
    'api',
    path,
    '-H',
    'Accept: application/vnd.github+json',
    '-H',
    'X-GitHub-Api-Version: 2022-11-28',
  ];

  if (method !== 'GET') {
    args.push('-X', method);
  }

  const hasBody = options.body !== undefined;
  if (hasBody) {
    args.push('--input', '-');
  }

  const output = execFileSync('gh', args, {
    encoding: 'utf-8',
    input: hasBody ? JSON.stringify(options.body) : undefined,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: options.timeoutMs || 30000,
  });

  const trimmed = output.trim();
  return (trimmed ? JSON.parse(trimmed) : undefined) as T;
}

export function ghSecretSet(fullName: string, name: string, value: string): void {
  execFileSync('gh', ['secret', 'set', name, '--repo', fullName], {
    encoding: 'utf-8',
    input: value,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30000,
  });
}
