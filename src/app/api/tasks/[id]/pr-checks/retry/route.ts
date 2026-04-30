import { NextRequest, NextResponse } from 'next/server';
import { retryTaskPrChecks } from '@/lib/pr-recovery';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    return NextResponse.json(await retryTaskPrChecks(id));
  } catch (error) {
    console.error('[PRChecks] retry failed:', error);
    return NextResponse.json({ error: (error as Error).message || 'Failed to retry PR checks' }, { status: 500 });
  }
}
