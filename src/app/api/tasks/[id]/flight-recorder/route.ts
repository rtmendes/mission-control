import { NextResponse } from 'next/server';
import { buildTaskFlightRecorder } from '@/lib/task-flight-recorder';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/tasks/[id]/flight-recorder — Unified task timeline and diagnostics
export async function GET(
  request: Request,
  { params }: RouteParams
) {
  try {
    const { id } = await params;
    const recorder = buildTaskFlightRecorder(id);

    if (!recorder) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json(recorder);
  } catch (error) {
    console.error('Failed to build task flight recorder:', error);
    return NextResponse.json({ error: 'Failed to build task flight recorder' }, { status: 500 });
  }
}
