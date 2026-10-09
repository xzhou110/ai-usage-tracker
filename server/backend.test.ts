import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { initialState, providerIds } from '../shared/schema.ts';
import type { Connectors, Observation, ConnectorResult, ProviderId, DashboardSnapshot } from '../shared/schema.ts';
import { startServer } from './http.ts';
import { reconcileActions } from './actions.ts';
import { StateStore } from './store.ts';
import { ConnectorError } from './connectors/errors.ts';
import { CursorConnector } from './connectors/cursor.ts';
import { acquireLock } from './lock.ts';
import { ProviderService } from './providers.ts';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function observation(provider: ProviderId = 'codex', usedPercent = 20, resetAt = '2099-01-01T00:00:00.000Z'): Observation {
  return { id: 'synthetic-observation', provider, observedAt: new Date().toISOString(), receivedAt: new Date().toISOString(), source: provider === 'codex' ? 'codex-app-server' : provider === 'claude' ? 'claude-statusline' : 'cursor-browser', windows: [{ key: 'included:primary', label: 'Included Session', kind: 'quota', scope: 'personal', usedPercent, used: null, limit: null, unit: 'percent', resetAt, durationMinutes: 300, cycleId: resetAt, detail: null }] };
}

function fakeConnectors() {
  const calls = Object.fromEntries(providerIds.map(id => [id, { connect: 0, refresh: 0, disconnect: 0, close: 0 }])) as Record<ProviderId, Record<'connect' | 'refresh' | 'disconnect' | 'close', number>>;
  const result = Object.fromEntries(providerIds.map(id => [id, { observation: observation(id), message: 'Synthetic quota evidence.' }])) as Record<ProviderId, ConnectorResult>;
  const failure: Partial<Record<ProviderId, Error>> = {};
  const connectors = Object.fromEntries(providerIds.map(id => [id, {
    connect: async () => { calls[id].connect++; if (failure[id]) throw failure[id]; return structuredClone(result[id]); },
    refresh: async () => { calls[id].refresh++; if (failure[id]) throw failure[id]; return structuredClone(result[id]); },
    disconnect: async () => { calls[id].disconnect++; },
    close: async () => { calls[id].close++; },
  }])) as Connectors;
  return { connectors, calls, result, failure };
}

async function temporary() {
  const root = await mkdtemp(path.join(tmpdir(), 'ai-usage-tracker-test-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function fixture() {
  const root = await temporary();
  const distDir = path.join(root, 'test-dist');
  await mkdir(distDir);
  await writeFile(path.join(distDir, 'index.html'), '<!doctype html><title>Synthetic Tracker</title>');
  await writeFile(path.join(distDir, 'UPPER.JS'), 'globalThis.synthetic = true;');
  const fake = fakeConnectors();
  const app = await startServer({ root, distDir, connectors: fake.connectors, port: 0, watch: false, poll: false, throttleMs: 0 });
  cleanup.push(() => app.close());
  return { root, distDir, app, ...fake };
}

describe('Manual Refresh Cooldown', () => {
  it('allows a manual Claude refresh after passive polling but still throttles repeated clicks', async () => {
    const root = await temporary();
    const store = new StateStore(root);
    await store.initialize(false);
    cleanup.push(() => store.close());
    const fake = fakeConnectors();
    const service = new ProviderService(store, fake.connectors);
    cleanup.push(() => service.close());
    await store.transaction(state => { state.providers.find(item => item.id === 'claude')!.enabled = true; });
    expect((await service.request('claude', 'refresh', true)).accepted).toBe(true);
    // Polling has settled once its observation is persisted and reservation released.
    for (let attempt = 0; attempt < 100 && !(await store.snapshot()).providers.find(item => item.id === 'claude')!.observation; attempt++) await delay(10);
    await delay(10);
    const manual = await service.request('claude', 'refresh');
    expect(manual.accepted).toBe(true);
    await delay(30);
    expect(await service.request('claude', 'refresh')).toMatchObject({ accepted: false });
    expect(fake.calls.claude.refresh).toBe(2);
  });
});

async function getStatus(app: Awaited<ReturnType<typeof startServer>>): Promise<DashboardSnapshot> {
  const response = await fetch(`${app.url}/api/status`);
  expect(response.status).toBe(200);
  return response.json();
}

async function mutation(app: Awaited<ReturnType<typeof startServer>>, route: string, value: unknown = {}, method = 'POST', etag?: string): Promise<Response> {
  return fetch(`${app.url}${route}`, { method, headers: { 'content-type': 'application/json', 'x-ai-usage-tracker': '1', ...(etag ? { 'if-match': etag } : {}) }, body: JSON.stringify(value) });
}

async function settled(app: Awaited<ReturnType<typeof startServer>>, provider: ProviderId, status = 'connected'): Promise<DashboardSnapshot> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const snapshot = await getStatus(app);
    if (snapshot.providers.find(item => item.id === provider)?.status === status) return snapshot;
    await delay(10);
  }
  throw new Error('Synthetic provider did not settle.');
}

async function raw(port: number, target: string, headers = '', host = `127.0.0.1:${port}`): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let output = '';
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Raw request timed out.')); });
    socket.on('connect', () => socket.end(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n${headers}\r\n`));
    socket.on('data', chunk => { output += chunk.toString(); });
    socket.on('error', reject);
    socket.on('end', () => resolve(output));
  });
}

describe('Local HTTP Boundaries', () => {
  it('saves membership privately with revision protection and never changes quota', async () => {
    const { app } = await fixture();
    const before = await getStatus(app);
    const membership = { plan: 'Synthetic Plan', price: 0, currency: 'USD', billingPeriod: 'month' };
    const route = '/api/providers/codex/membership';
    expect((await mutation(app, route, membership, 'PUT')).status).toBe(428);
    expect((await mutation(app, route, { ...membership, price: -1 }, 'PUT', `"${before.revision}"`)).status).toBe(422);
    expect((await mutation(app, route, membership, 'PUT', `"${before.revision}"`)).status).toBe(200);
    expect((await mutation(app, route, { ...membership, price: 20 }, 'PUT', `"${before.revision}"`)).status).toBe(412);
    const after = await getStatus(app);
    expect(after.providers[1].membership).toEqual(membership);
    expect(after.providers.map(provider => provider.observation)).toEqual(before.providers.map(provider => provider.observation));
    expect(after.providers[0].membership.price).toBeNull();
  });

  it('reads old state without membership and preserves history and settings on upgrade', async () => {
    const root = await temporary();
    const legacy = JSON.parse(JSON.stringify(initialState()));
    for (const provider of legacy.providers) delete provider.membership;
    legacy.settings.warningPercent = 91;
    const oldObservation = observation();
    legacy.providers[1].observation = oldObservation;
    await mkdir(path.join(root, 'local', 'history', 'codex'), { recursive: true });
    await writeFile(path.join(root, 'local', 'history', 'codex', `${oldObservation.id}.json`), JSON.stringify(oldObservation));
    await writeFile(path.join(root, 'local', 'state.json'), JSON.stringify(legacy));
    const store = new StateStore(root);
    await store.initialize(false);
    cleanup.push(() => store.close());
    const snapshot = await store.snapshot();
    expect(snapshot.settings.warningPercent).toBe(91);
    expect(snapshot.providers.every(provider => provider.membership.plan === null && provider.membership.price === null)).toBe(true);
    expect(snapshot.providers[1].observation).toEqual(oldObservation);
    expect((await store.history()).observations).toEqual([oldObservation]);
  });
  it('starts disconnected without invoking any connector and serves the production surface', async () => {
    const { app, calls } = await fixture();
    const snapshot = await getStatus(app);
    expect(snapshot.providers.map(provider => [provider.id, provider.enabled, provider.observation])).toEqual(providerIds.map(id => [id, false, null]));
    expect(snapshot.actions.filter(action => action.state === 'open')).toHaveLength(3);
    expect(Object.values(calls).every(value => value.connect === 0 && value.refresh === 0)).toBe(true);
    const page = await fetch(app.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Synthetic Tracker');
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(page.headers.get('cache-control')).toBe('no-store');
    const head = await fetch(`${app.url}/UPPER.JS`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toContain('javascript');
    expect(await head.text()).toBe('');
    expect((await fetch(`${app.url}/api/missing`)).status).toBe(404);
    expect((await fetch(`${app.url}/missing.js`)).status).toBe(404);
    expect((await fetch(`${app.url}/missing`)).status).toBe(404);
  });

  it('rejects foreign origins, exact-port Host mismatches, and missing mutation headers', async () => {
    const { app } = await fixture();
    expect(await raw(app.port, '/api/health', '', '127.0.0.1:1')).toContain('403 Forbidden');
    expect((await fetch(`${app.url}/api/health`, { headers: { origin: 'https://example.invalid' } })).status).toBe(403);
    expect((await fetch(`${app.url}/api/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await fetch(`${app.url}/api/refresh`, { method: 'POST', headers: { 'x-ai-usage-tracker': '1', 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await fetch(`${app.url}/api/health`, { headers: { origin: app.url } })).status).toBe(200);
  });

  it('rejects malformed raw targets and keeps serving after parser errors', async () => {
    const { app } = await fixture();
    for (const target of ['//', '/%zz', '/%2e%2e/private', '/..%5cprivate', '/C:/private', '/%252e%252e/private', '/NUL.txt', '/api/history?cursor=%zz']) {
      expect(await raw(app.port, target)).toContain('400 Bad Request');
    }
    expect(await raw(app.port, '/api/health', 'Bad Header: value\r\n')).toContain('400 Bad Request');
    expect((await fetch(`${app.url}/api/health`)).status).toBe(200);
  });

  it('returns safe malformed-JSON and body-size errors without killing the listener', async () => {
    const { app } = await fixture();
    const headers = { 'content-type': 'application/json', 'x-ai-usage-tracker': '1' };
    const malformed = await fetch(`${app.url}/api/refresh`, { method: 'POST', headers, body: '{synthetic-private-value' });
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain('synthetic-private-value');
    const large = await fetch(`${app.url}/api/refresh`, { method: 'POST', headers, body: JSON.stringify({ value: 'x'.repeat(1024 * 1024) }) });
    expect(large.status).toBe(413);
    expect((await fetch(`${app.url}/api/health`)).status).toBe(200);
  });
});

describe('State, Provider, and Action Behavior', () => {
  it('validates settings and protects simultaneous writes with the exact state ETag', async () => {
    const { app } = await fixture();
    const before = await getStatus(app);
    const settings = { ...before.settings, warningPercent: 75 };
    expect((await mutation(app, '/api/settings', settings, 'PUT')).status).toBe(428);
    expect((await mutation(app, '/api/settings', { ...settings, timezone: 'Not/AZone' }, 'PUT', `"${before.revision}"`)).status).toBe(422);
    const responses = await Promise.all([mutation(app, '/api/settings', settings, 'PUT', `"${before.revision}"`), mutation(app, '/api/settings', { ...settings, warningPercent: 65 }, 'PUT', `"${before.revision}"`)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 412]);
    const current = await getStatus(app);
    expect([65, 75]).toContain(current.settings.warningPercent);
  });

  it('accepts connection promptly, serializes duplicates, and preserves observations on errors', async () => {
    const { app, connectors, failure } = await fixture();
    let complete!: (result: ConnectorResult) => void;
    connectors.codex.connect = () => new Promise(resolve => { complete = resolve; });
    const started = await mutation(app, '/api/providers/codex/connect');
    expect(started.status).toBe(202);
    expect((await started.json()).accepted).toBe(true);
    const duplicate = await mutation(app, '/api/providers/codex/connect');
    expect((await duplicate.json()).accepted).toBe(false);
    complete({ observation: observation('codex', 99), message: 'Synthetic quota evidence.' });
    const connected = await settled(app, 'codex');
    expect(connected.providers[1].observation?.windows[0].usedPercent).toBe(99);
    failure.codex = new ConnectorError('SOURCE_UNAVAILABLE', 'The synthetic installed application is unavailable.');
    await mutation(app, '/api/providers/codex/refresh');
    const failed = await settled(app, 'codex', 'error');
    expect(failed.providers[1].observation).toEqual(connected.providers[1].observation);
    expect(failed.providers[1].message).toBe('The synthetic installed application is unavailable.');
    expect(failed.providers[0].status).toBe('disconnected');
    const disconnected = await mutation(app, '/api/providers/codex/disconnect');
    expect(disconnected.status).toBe(200);
    expect((await disconnected.json()).providers[1].observation).toEqual(connected.providers[1].observation);
    expect((await mutation(app, '/api/providers/codex/refresh')).status).toBe(409);
  });

  it('keeps history immutable without saving unchanged quota as another record', async () => {
    const { app, result, root } = await fixture();
    await mutation(app, '/api/providers/codex/connect');
    await settled(app, 'codex');
    const directory = path.join(root, 'local/history/codex');
    const [name] = await readdir(directory);
    const original = await readFile(path.join(directory, name), 'utf8');
    result.codex.observation!.observedAt = new Date(Date.now() + 1000).toISOString();
    await mutation(app, '/api/providers/codex/refresh');
    await delay(40);
    expect(await readdir(directory)).toEqual([name]);
    expect(await readFile(path.join(directory, name), 'utf8')).toBe(original);
    result.codex.observation!.windows[0].usedPercent = 45;
    await mutation(app, '/api/providers/codex/refresh');
    await delay(40);
    const history = await (await fetch(`${app.url}/api/history?provider=codex`)).json();
    expect(history.observations).toHaveLength(2);
    expect(history.nextCursor).toBeNull();
    expect((await fetch(`${app.url}/api/history?provider=invalid`)).status).toBe(400);
    expect((await fetch(`${app.url}/api/history?cursor=not-json`)).status).toBe(400);
  });

  it('uses passive observation time and does not freshen repeated Claude input', async () => {
    const { app, result } = await fixture();
    const old = new Date(Date.now() - 3_600_000).toISOString();
    result.claude.observation!.observedAt = old;
    await mutation(app, '/api/providers/claude/connect');
    const before = await settled(app, 'claude');
    expect(before.providers[0].freshness).toBe('stale');
    result.claude.observation!.observedAt = new Date().toISOString();
    result.claude.observation!.receivedAt = new Date().toISOString();
    await mutation(app, '/api/providers/claude/refresh');
    await delay(30);
    const after = await getStatus(app);
    expect(after.providers[0].observation!.observedAt).toBe(old);
    expect(after.providers[0].freshness).toBe('stale');
  });

  it('retains dismissed/resolved action history and refuses reopening resolved conditions', async () => {
    const { app, result } = await fixture();
    let state = await getStatus(app);
    const action = state.actions.find(item => item.provider === 'codex')!;
    const dismiss = await mutation(app, `/api/actions/${encodeURIComponent(action.id)}/dismiss`, {}, 'POST', `"${state.revision}"`);
    expect(dismiss.status).toBe(200);
    state = await dismiss.json();
    expect(state.actions.find(item => item.id === action.id)?.state).toBe('dismissed');
    result.codex.observation!.windows[0].usedPercent = 100;
    await mutation(app, '/api/providers/codex/connect');
    state = await settled(app, 'codex');
    expect(state.actions.find(item => item.id === action.id)?.state).toBe('resolved');
    expect((await mutation(app, `/api/actions/${encodeURIComponent(action.id)}/reopen`, {}, 'POST', `"${state.revision}"`)).status).toBe(409);
    expect(state.actions.some(item => item.kind === 'exhausted' && item.state === 'open')).toBe(true);
  });

  it('persists preferences across restart and prevents a second instance', async () => {
    const { root, distDir, app, connectors } = await fixture();
    const state = await getStatus(app);
    expect((await mutation(app, '/api/settings', { ...state.settings, timezone: 'UTC' }, 'PUT', `"${state.revision}"`)).status).toBe(200);
    await expect(startServer({ root, port: 0, connectors, watch: false, poll: false })).rejects.toMatchObject({ status: 409 });
    await app.close();
    const restarted = await startServer({ root, distDir, port: 0, connectors, watch: false, poll: false });
    cleanup.push(() => restarted.close());
    expect((await getStatus(restarted)).settings.timezone).toBe('UTC');
  });

  it('waits for the Cursor browser after restart while preserving its last observation', async () => {
    const { root, distDir, app } = await fixture();
    await mutation(app, '/api/providers/cursor/connect');
    const before = await settled(app, 'cursor');
    expect(before.providers[2].status).toBe('connected');
    await app.close();
    const fresh = fakeConnectors();
    fresh.connectors.cursor = new CursorConnector(root);
    const restarted = await startServer({ root, distDir, port: 0, connectors: fresh.connectors, watch: false, poll: false, throttleMs: 0 });
    cleanup.push(() => restarted.close());
    const waiting = await getStatus(restarted);
    expect(waiting.providers[2]).toMatchObject({ enabled: true, status: 'waiting', verified: false, errorCode: null, nextRefreshAt: null, observation: before.providers[2].observation });
    expect(waiting.providers[2].message).toContain('normal browser');
    expect(fresh.calls.cursor.connect).toBe(0);
    expect(fresh.calls.cursor.refresh).toBe(0);
    const reconnect = await mutation(restarted, '/api/providers/cursor/connect');
    expect(reconnect.status).toBe(202);
    expect((await reconnect.json()).accepted).toBe(true);
    const blocked = await settled(restarted, 'cursor', 'waiting');
    expect(blocked.providers[2]).toMatchObject({ errorCode: null, observation: before.providers[2].observation });
    await mutation(restarted, '/api/providers/cursor/refresh');
    expect((await settled(restarted, 'cursor', 'waiting')).providers[2].observation).toEqual(before.providers[2].observation);
  });

  it('delegates explicit Cursor reconnect after its browser closes and still serializes duplicate clicks', async () => {
    const { app, connectors, calls } = await fixture();
    await mutation(app, '/api/providers/cursor/connect');
    const before = await settled(app, 'cursor');
    expect(calls.cursor.connect).toBe(1);
    // Closing a browser does not change the persisted provider state. Its connector
    // needs a second Connect call to recreate the missing process-local context.
    let complete!: (result: ConnectorResult) => void;
    connectors.cursor.connect = () => {
      calls.cursor.connect++;
      return new Promise(resolve => { complete = resolve; });
    };
    const reconnect = await mutation(app, '/api/providers/cursor/connect');
    expect(reconnect.status).toBe(202);
    expect((await reconnect.json()).accepted).toBe(true);
    expect(calls.cursor.connect).toBe(2);
    const duplicate = await mutation(app, '/api/providers/cursor/connect');
    expect((await duplicate.json()).accepted).toBe(false);
    expect(calls.cursor.connect).toBe(2);
    complete({ observation: null, waiting: true, message: 'Synthetic browser reopened. Refresh after sign-in.' });
    const after = await settled(app, 'cursor', 'waiting');
    expect(after.providers[2].observation).toEqual(before.providers[2].observation);
  });

  it('never overwrites a malformed state file and returns a generic storage error', async () => {
    const { app, root } = await fixture();
    const file = path.join(root, 'local/state.json');
    const bad = '{synthetic-private-state';
    await writeFile(file, bad);
    const response = await fetch(`${app.url}/api/status`);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('synthetic-private-state');
    expect(await readFile(file, 'utf8')).toBe(bad);
    await app.close();
    await expect(startServer({ root, port: 0, connectors: fakeConnectors().connectors, watch: false, poll: false })).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    expect(await readFile(file, 'utf8')).toBe(bad);
  });

  it('emits one SSE revision for one write and ignores unchanged reads', async () => {
    const { app } = await fixture();
    let events = '';
    const request = http.get(`${app.url}/api/events`);
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => { request.on('response', resolve); request.on('error', reject); });
    response.on('data', chunk => { events += chunk.toString(); });
    cleanup.push(async () => { response.destroy(); request.destroy(); });
    const before = await getStatus(app);
    const change = await mutation(app, '/api/settings', { ...before.settings, warningPercent: 91 }, 'PUT', `"${before.revision}"`);
    expect(change.status).toBe(200);
    await getStatus(app);
    await getStatus(app);
    await delay(30);
    expect(events.match(/event: change/g)).toHaveLength(1);
    expect(events).not.toContain('windows');
  });
});

describe('Single-Writer Lock Recovery', () => {
  const deadPid = 2_147_483_647;

  it('allows exactly one owner across repeated simultaneous stale-lock recoveries', async () => {
    const root = await temporary();
    const directory = path.join(root, 'local');
    await mkdir(directory);
    expect(() => process.kill(deadPid, 0)).toThrow();
    for (let round = 0; round < 25; round++) {
      await writeFile(path.join(directory, 'server.lock'), JSON.stringify({ pid: deadPid, port: 0, token: `dead-${round}` }));
      const contenders = await Promise.allSettled(Array.from({ length: 12 }, () => acquireLock(root, 0)));
      const owners = contenders.filter((result): result is PromiseFulfilledResult<() => Promise<void>> => result.status === 'fulfilled');
      try {
        expect(owners).toHaveLength(1);
        for (const result of contenders) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'CONFLICT' });
        const winner = JSON.parse(await readFile(path.join(directory, 'server.lock'), 'utf8'));
        expect(winner.pid).toBe(process.pid);
        await expect(acquireLock(root, 0)).rejects.toMatchObject({ code: 'CONFLICT' });
      } finally { await Promise.all(owners.map(owner => owner.value())); }
    }
  });

  it('keeps an interrupted recovery guard intact instead of racing its replacement', async () => {
    const root = await temporary();
    const directory = path.join(root, 'local');
    await mkdir(directory);
    const bytes = JSON.stringify({ pid: deadPid, port: 0, token: 'synthetic-interrupted-recovery' }); // secret-scan: allow (synthetic lock-owner fixture, not a credential)
    await writeFile(path.join(directory, 'server.lock'), bytes);
    await writeFile(path.join(directory, 'server-recovery.lock'), bytes);
    const contenders = await Promise.allSettled(Array.from({ length: 12 }, () => acquireLock(root, 0)));
    expect(contenders.every(result => result.status === 'rejected' && result.reason.message.includes('server-recovery.lock'))).toBe(true);
    expect(await readFile(path.join(directory, 'server.lock'), 'utf8')).toBe(bytes);
    expect(await readFile(path.join(directory, 'server-recovery.lock'), 'utf8')).toBe(bytes);
  });

  it('makes release idempotent so an old release cannot delete a successor', async () => {
    const root = await temporary();
    const release = await acquireLock(root, 0);
    await Promise.all([release(), release()]);
    const successor = await acquireLock(root, 0);
    cleanup.push(successor);
    const current = await readFile(path.join(root, 'local/server.lock'), 'utf8');
    await release();
    expect(await readFile(path.join(root, 'local/server.lock'), 'utf8')).toBe(current);
    await expect(acquireLock(root, 0)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('Time and Durable History', () => {
  it('does not replenish expired quota and creates a new action in the next cycle', () => {
    const state = initialState();
    const provider = state.providers[1];
    provider.enabled = true;
    provider.status = 'connected';
    provider.observation = observation('codex', 100, '2026-10-05T23:00:00.000Z');
    reconcileActions(state, new Date('2026-10-05T22:00:00.000Z'));
    const exhausted = state.actions.find(action => action.kind === 'exhausted')!;
    exhausted.state = 'dismissed';
    reconcileActions(state, new Date('2026-10-06T00:00:00.000Z'));
    expect(provider.observation.windows[0].usedPercent).toBe(100);
    expect(exhausted.state).toBe('resolved');
    expect(state.actions.some(action => action.kind === 'awaiting-confirmation' && action.state === 'open')).toBe(true);
    provider.observation = observation('codex', 100, '2026-10-07T23:00:00.000Z');
    reconcileActions(state, new Date('2026-10-06T00:00:00.000Z'));
    const next = state.actions.find(action => action.kind === 'exhausted' && action.state === 'open')!;
    expect(next.id).not.toBe(exhausted.id);
  });

  it('paginates all history without a retention cap', async () => {
    const root = await temporary();
    const store = new StateStore(root);
    await store.initialize(false);
    cleanup.push(() => store.close());
    const directory = path.join(root, 'local/history/codex');
    await mkdir(directory, { recursive: true });
    for (let index = 0; index < 103; index++) {
      const value = { ...observation(), id: `fixture-${index}`, observedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() };
      await writeFile(path.join(directory, `${value.id}.json`), JSON.stringify(value));
    }
    const first = await store.history('codex');
    expect(first.observations).toHaveLength(100);
    const second = await store.history('codex', first.nextCursor!);
    expect(second.observations).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.observations, ...second.observations].map(item => item.id)).size).toBe(103);
    await expect(store.history(undefined, first.nextCursor!)).rejects.toMatchObject({ status: 400 });
  });
});
