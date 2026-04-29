import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { applyRepoReadinessFix } from '@/lib/repo-readiness';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const FixSchema = z.object({
  kind: z.enum(['set_workflow_permissions_write', 'set_actions_enabled_all', 'set_secret', 'set_variable']),
  targetName: z.string().max(200).optional(),
  value: z.string().max(10000).optional(),
});

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const input = FixSchema.parse(await request.json());
    return NextResponse.json(await applyRepoReadinessFix(id, input));
  } catch (error) {
    console.error('[RepoReadiness] fix failed:', error);
    const status = error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: (error as Error).message || 'Failed to apply repo fix' }, { status });
  }
}
