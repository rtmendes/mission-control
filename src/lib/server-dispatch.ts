import { getMissionControlUrl } from '@/lib/config';

export interface ServerDispatchResult {
  success: boolean;
  error?: string;
  status?: number;
}

/**
 * Server-side dispatch helper.
 *
 * Client code can use relative fetch URLs, but route handlers cannot. Keeping
 * server dispatch here prevents accidental imports of browser-only helpers from
 * API routes.
 */
export async function dispatchTaskFromServer(taskId: string): Promise<ServerDispatchResult> {
  const missionControlUrl = getMissionControlUrl();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (process.env.MC_API_TOKEN) {
    headers.Authorization = `Bearer ${process.env.MC_API_TOKEN}`;
  }

  try {
    const response = await fetch(`${missionControlUrl}/api/tasks/${taskId}/dispatch`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(30_000),
    });

    if (response.ok) {
      return { success: true, status: response.status };
    }

    const errorText = await response.text();
    return {
      success: false,
      status: response.status,
      error: `Dispatch failed (${response.status}): ${errorText}`,
    };
  } catch (error) {
    return {
      success: false,
      error: `Dispatch error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
