import { DashboardSnapshotSchema, ObservationSchema, type DashboardSnapshot, type HistoryPage } from '../shared/schema';
import { z } from 'zod';

export class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function request<T>(path: string, options: { method?: string; body?: unknown; revision?: string; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.method) { headers['Content-Type'] = 'application/json'; headers['X-AI-Usage-Tracker'] = '1'; }
  if (options.revision) headers['If-Match'] = `"${options.revision}"`;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method || 'GET', headers, cache: 'no-store',
      body: options.method ? JSON.stringify(options.body ?? {}) : undefined,
      signal: options.signal ?? AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new RequestError(0, 'The local tracker is unavailable. Check that it is running, then try again.');
  }
  if (!response.ok) {
    // The local server constructs this safe envelope; never render a raw response body.
    const messages: Record<number, string> = {
      403: 'The tracker rejected this request. Open it from its local address and try again.',
      409: 'This action is not available in the current connection state. Refresh the page and try again.',
      412: 'The dashboard changed while you were editing. Your edits have been preserved.',
      422: 'Some settings are invalid. Check the fields and try again.',
      500: 'The tracker could not safely save or read its local data. Your previous data has been preserved.',
      503: 'This connection is unavailable. Check its setup instructions and try again.',
    };
    const envelope = z.object({ error: z.object({ code: z.string().max(80), message: z.string().min(1).max(1000) }).strict() }).strict();
    let safeMessage: string | undefined;
    try { const parsed = envelope.safeParse(await response.json()); if (parsed.success) safeMessage = parsed.data.error.message; } catch { /* Use the generic message for malformed responses. */ }
    throw new RequestError(response.status, safeMessage || messages[response.status] || 'The request could not be completed. Please try again.');
  }
  return response.json() as Promise<T>;
}

export async function loadStatus(): Promise<DashboardSnapshot> {
  return DashboardSnapshotSchema.parse(await request('/status'));
}

export async function loadHistory(provider: string, cursor: string | null, signal?: AbortSignal): Promise<HistoryPage> {
  const query = new URLSearchParams();
  if (provider !== 'all') query.set('provider', provider);
  if (cursor) query.set('cursor', cursor);
  return z.object({ observations: z.array(ObservationSchema), nextCursor: z.string().nullable() }).parse(
    await request(`/history?${query.toString()}`, { signal }),
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof RequestError ? error.message : 'The tracker returned an unexpected response. Refresh to try again.';
}
