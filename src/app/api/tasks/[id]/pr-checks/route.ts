import { NextRequest, NextResponse } from 'next/server';
import { getTaskPrChecks } from '@/lib/pr-recovery';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return NextResponse.json(await getTaskPrChecks(id));
  } catch (error) {
    console.error('[PRChecks] GET failed:', error);
    return NextResponse.json({ error: (error as Error).message || 'Failed to load PR checks' }, { status: 500 });
  }
}
