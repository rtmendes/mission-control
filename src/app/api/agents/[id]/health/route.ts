import { NextRequest, NextResponse } from 'next/server';
import { evaluateAgentHealth, getAgentHealth } from '@/lib/agent-health';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/agents/[id]/health — Get health state of one agent
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const health = getAgentHealth(id);
    if (!health) {
      // No health record yet — compute live with the richer display state.
      const evaluation = evaluateAgentHealth(id);
      return NextResponse.json({ ...evaluation, computed: true });
    }

    return NextResponse.json(health);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch agent health' }, { status: 500 });
  }
}
