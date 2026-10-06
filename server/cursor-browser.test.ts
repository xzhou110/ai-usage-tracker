import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { startServer } from './http.ts';
import { CursorConnector, parseCursorPayload } from './connectors/cursor.ts';
import { CursorBrowserBridge } from './connectors/cursor-browser.ts';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const origin = `chrome-extension://${'a'.repeat(32)}`;
const foreign = `chrome-extension://${'b'.repeat(32)}`;
const quota = () => ({ observedAt: new Date().toISOString(), payload: { billingCycleEnd: '2099-01-01T00:00:00.000Z', individualUsage: { plan: { used: 100, limit: 1000 } } } });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ai-usage-tracker-browser-test-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const dist = path.join(root, 'dist'); await mkdir(dist); await writeFile(path.join(dist, 'index.html'), '<title>Synthetic</title>');
  const cursor = new CursorConnector(root);
  const fake = { connect: async () => ({ observation: null, waiting: true, message: 'Synthetic source.' }), refresh: async () => ({ observation: null, waiting: true, message: 'Synthetic source.' }), disconnect: async () => {}, close: async () => {} };
  const app = await startServer({ root, distDir: dist, connectors: { cursor, claude: fake, codex: fake }, port: 0, poll: false, watch: false, throttleMs: 0 });
  cleanups.push(() => app.close());
  const own = (route: string) => fetch(`${app.url}/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ai-usage-tracker': '1' }, body: '{}' });
  const post = (route: string, data: unknown, token = '', from = origin) => fetch(`${app.url}/api/cursor-browser/${route}`, { method: 'POST', headers: { origin: from, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
  const pair = async () => { const code = (await (await own('cursor-browser/pairing')).json()).code; const response = await post('pair', { code }); expect(response.status).toBe(200); return (await response.json()).token as string; };
  return { root, app, cursor, own, post, pair };
}
describe('Cursor Browser Pairing and Privacy', () => {
  it('requires app-initiated pairing and keeps every unrelated route same-origin', async () => {
    const { app, own, post } = await fixture();
    expect((await fetch(`${app.url}/api/cursor-browser/pairing`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await fetch(`${app.url}/api/status`, { headers: { origin } })).status).toBe(403);
    expect((await post('pair', { code: '0'.repeat(32) }, '', 'https://cursor.com')).status).toBe(403);
    const code = (await (await own('cursor-browser/pairing')).json()).code;
    expect((await post('pair', { code })).status).toBe(200);
    expect((await post('pair', { code })).status).toBe(403);
    expect((await fetch(`${app.url}/api/cursor-browser/pair`, { method: 'POST', headers: { origin, host: `localhost:${app.port}`, 'content-type': 'application/json' }, body: JSON.stringify({ code }) })).status).toBe(403);
    const preflight = await fetch(`${app.url}/api/cursor-browser/reading`, { method: 'OPTIONS', headers: { origin } });
    expect(preflight.status).toBe(204); expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
  });
  it('accepts only the paired origin/token and strict quota, preserves prior data on rejection, and revokes access', async () => {
    const { root, app, own, post, pair } = await fixture(); const token = await pair();
    expect((await post('reading', quota())).status).toBe(403);
    expect((await post('reading', quota(), token, foreign)).status).toBe(403);
    expect((await post('reading', { ...quota(), identity: 'synthetic-private-marker' }, token)).status).toBe(422);
    expect((await post('reading', { ...quota(), observedAt: '2000-01-01T00:00:00.000Z' }, token)).status).toBe(422);
    expect((await post('reading', { ...quota(), payload: {} }, token)).status).toBe(422);
    expect((await post('reading', quota(), token)).status).toBe(200);
    const snapshot = await (await fetch(`${app.url}/api/status`)).json();
    expect(snapshot.providers[2]).toMatchObject({ status: 'connected', enabled: true, verified: false });
    expect(snapshot.providers[2].observation.windows[0]).toMatchObject({ used: 1, limit: 10, usedPercent: 10 });
    const stored = await readFile(path.join(root, 'local', 'cursor-browser-connection.json'), 'utf8');
    expect(stored).not.toContain(token); expect(stored).not.toContain('synthetic-private-marker');
    const all = await (await own('refresh')).json(); expect(all.operations.find((item: {provider: string}) => item.provider === 'cursor').accepted).toBe(false);
    expect((await own('providers/cursor/disconnect')).status).toBe(200);
    expect((await post('reading', quota(), token)).status).toBe(403);
    const after = await (await fetch(`${app.url}/api/status`)).json();
    expect(after.providers[2].enabled).toBe(false); expect(after.providers[2].observation).toEqual(snapshot.providers[2].observation);
  });
  it('supports revocation before the first reading and rejects oversized updates', async () => {
    const { own, post, pair } = await fixture(); const token = await pair();
    expect((await post('reading', { extra: 'x'.repeat(32768) }, token)).status).toBe(413);
    expect((await own('providers/cursor/disconnect')).status).toBe(200);
    expect((await post('reading', quota(), token)).status).toBe(403);
  });
  it('expires one-use codes and serializes Disconnect ahead of queued updates', async () => {
    const { root } = await fixture(); const bridge = new CursorBrowserBridge(root);
    const now = Date.now(); const code = await bridge.issuePairing();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60000);
    await expect(bridge.pair(origin, code.code)).rejects.toMatchObject({ status: 403 }); clock.mockRestore();
    const fresh = await bridge.issuePairing(); const { token } = await bridge.pair(origin, fresh.code);
    const receive = vi.fn(async () => {});
    const revoked = bridge.disconnect(); const queued = bridge.accept(origin, token, quota(), parseCursorPayload, receive);
    await revoked; await expect(queued).rejects.toMatchObject({ status: 403 }); expect(receive).not.toHaveBeenCalled();
  });
  it('keeps source timestamps on restart and refresh instead of manufacturing a fresh reading', async () => {
    const { root, cursor, post, pair } = await fixture(); const token = await pair(); const reading = quota();
    expect((await post('reading', reading, token)).status).toBe(200);
    const previous = await cursor.refresh(); const restarted = new CursorConnector(root);
    expect((await restarted.connect()).observation).toEqual(previous.observation);
    expect(previous.observation?.observedAt).toBe(reading.observedAt);
    await restarted.disconnect(); expect((await restarted.refresh()).waiting).toBe(true);
  });
});
describe('Actual Extension Quota Reader', () => {
  it('restricts worker senders and forgets a revoked token before the next quota read', async () => {
    const source = await readFile(new URL('../browser-extension/background.js', import.meta.url), 'utf8');
    const id = 'a'.repeat(32); const saved: Record<string, unknown> = { token: 'c'.repeat(64) }; // secret-scan: allow (synthetic local bridge token)
    let handler!: (message: unknown, sender: unknown, respond: (result: any) => void) => void;
    const fetch = vi.fn(async () => new Response('{}', { status: 403 }));
    vm.runInNewContext(source, { URL, AbortSignal, fetch, chrome: {
      runtime: { id, getURL: (value: string) => `${origin}/${value}`, onMessage: { addListener: (callback: typeof handler) => { handler = callback; } } },
      storage: { local: { setAccessLevel: async () => {}, get: async () => ({ ...saved }), set: async (value: object) => Object.assign(saved, value), remove: async (key: string) => { delete saved[key]; } } },
    } });
    const sender = { id, frameId: 0, tab: { id: 1 }, url: 'https://cursor.com/dashboard?tab=usage' };
    const send = (message: unknown, from: unknown = sender) => new Promise<any>(resolve => handler(message, from, resolve));
    expect((await send({ type: 'quota', data: quota() }, { ...sender, url: 'https://example.invalid/dashboard' })).ok).toBe(false);
    expect((await send({ type: 'quota', data: quota() }, { ...sender, frameId: 1 })).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect((await send({ type: 'quota', data: quota() })).ok).toBe(false);
    expect((await send({ type: 'can-read' })).ok).toBe(false);
    expect(saved.token).toBeUndefined(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('requests only quota and discards private fields before crossing the extension boundary', async () => {
    const source = await readFile(new URL('../browser-extension/quota-reader.js', import.meta.url), 'utf8');
    const response = new Response(JSON.stringify({ ...quota().payload, account: 'synthetic-private-marker', individualUsage: { plan: { used: 100, limit: 1000, identity: 'synthetic-private-marker' } } }), { headers: { 'content-type': 'application/json' } });
    Object.defineProperty(response, 'url', { value: 'https://cursor.com/api/usage-summary' });
    const fetch = vi.fn(async () => response);
    const read = vm.runInNewContext(`${source}\nreadCursorQuota`, { fetch, AbortController, setTimeout, clearTimeout, TextDecoder, Uint8Array, Date });
    const result = await read(); expect(JSON.stringify(result)).not.toContain('synthetic-private-marker');
    expect(result.payload.individualUsage.plan).toEqual({ used: 100, limit: 1000 });
    expect(fetch).toHaveBeenCalledWith('https://cursor.com/api/usage-summary', expect.objectContaining({ credentials: 'same-origin', redirect: 'error', method: 'GET' }));
  });
  it.each([['text/html', 'challenge'], ['application/json', '{"individualUsage":{"plan":{"used":"private"}}}']])('rejects challenge HTML and unexpected numeric types %s', async (type, body) => {
    const source = await readFile(new URL('../browser-extension/quota-reader.js', import.meta.url), 'utf8');
    const response = new Response(body, { headers: { 'content-type': type } }); Object.defineProperty(response, 'url', { value: 'https://cursor.com/api/usage-summary' });
    const read = vm.runInNewContext(`${source}\nreadCursorQuota`, { fetch: async () => response, AbortController, setTimeout, clearTimeout, TextDecoder, Uint8Array, Date });
    await expect(read()).rejects.toThrow();
  });
});
