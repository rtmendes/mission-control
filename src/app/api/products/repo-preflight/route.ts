import { NextRequest, NextResponse } from 'next/server';
import { preflightRepoAccess } from '@/lib/repo-preflight';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const repoUrl = typeof body.repo_url === 'string' ? body.repo_url.trim() : '';
    const branch = typeof body.default_branch === 'string' ? body.default_branch.trim() : undefined;

    if (!repoUrl) {
      return NextResponse.json({ error: 'repo_url is required' }, { status: 400 });
    }

    try {
      const parsed = new URL(repoUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'ssh:') {
        return NextResponse.json({ error: 'repo_url must use http, https, or ssh' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'repo_url must be a valid URL' }, { status: 400 });
    }

    return NextResponse.json(preflightRepoAccess(repoUrl, branch));
  } catch (error) {
    console.error('Failed to preflight repository:', error);
    return NextResponse.json({ error: 'Failed to preflight repository' }, { status: 500 });
  }
}
