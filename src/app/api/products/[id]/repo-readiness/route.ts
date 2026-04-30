import { NextRequest, NextResponse } from 'next/server';
import { getCachedRepoReadiness, scanRepoReadiness } from '@/lib/repo-readiness';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const cached = getCachedRepoReadiness(id);
    if (cached) return NextResponse.json(cached);
    return NextResponse.json(await scanRepoReadiness(id));
  } catch (error) {
    console.error('[RepoReadiness] GET failed:', error);
    return NextResponse.json({ error: (error as Error).message || 'Failed to load repo readiness' }, { status: 500 });
  }
}
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return NextResponse.json(await scanRepoReadiness(id));
  } catch (error) {
    console.error('[RepoReadiness] scan failed:', error);
    return NextResponse.json({ error: (error as Error).message || 'Failed to scan repo readiness' }, { status: 500 });
  }
}
