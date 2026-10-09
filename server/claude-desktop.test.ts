import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';
import { ClaudeConnector } from './connectors/claude.ts';
import { parseClaudeDesktop } from './connectors/claude-desktop.ts';
import { startServer } from './http.ts';
import type { Connectors, DashboardSnapshot } from '../shared/schema.ts';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const payload = (percentUsed = 23.5, observedAt = new Date().toISOString()) => ({
  observedAt, sentAt: new Date().toISOString(), rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: '2099-01-01T00:00:00.000Z' }],
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tracker-desktop-test-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'local'));
  await writeFile(join(root, 'local', 'claude-desktop-installed.json'), '{"version":1}');
  const unused = { connect: async () => ({ observation: null, message: 'Synthetic' }), refresh: async () => ({ observation: null, message: 'Synthetic' }), disconnect: async () => {}, close: async () => {} };
  const connectors: Connectors = { claude: new ClaudeConnector(root, join(root, 'native-settings.json')), codex: unused, cursor: unused };
  const app = await startServer({ root, port: 0, connectors, poll: false, watch: false, throttleMs: 0 });
  cleanup.push(() => app.close());
  const post = (route: string, value: unknown = {}, headers: Record<string, string> = {}) => fetch(`${app.url}/api/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AI-Usage-Tracker': '1', ...headers }, body: JSON.stringify(value),
  });
  const state = async () => (await (await fetch(`${app.url}/api/status`)).json() as DashboardSnapshot).providers[0];
  const connect = async () => {
    await post('providers/claude/connect');
    for (let i = 0; i < 100 && (await state()).status === 'connecting'; i++) await delay(10);
    await delay(10);
  };
  return { root, app, post, state, connect, connector: connectors.claude as ClaudeConnector };
}

it('accepts Desktop quota without a terminal bridge, preserves cached freshness and rejects late arrivals', async () => {
  const { post, state, connect, connector } = await fixture();
  expect((await post('claude-desktop/reading', payload())).status).toBe(409);
  await connect();
  expect((await state()).status).toBe('waiting');
  expect((await post('claude-desktop/reading', payload())).status).toBe(200);
  const first = (await state()).observation!;
  expect(first.source).toBe('claude-desktop-mod');
  expect(first.windows[0].usedPercent).toBe(23.5);
  await delay(5);
  expect((await post('claude-desktop/reading', payload())).status).toBe(200);
  expect((await state()).observation!.observedAt).toBe(first.observedAt);
  expect((await post('claude-desktop/reading', payload(1, '2026-01-01T00:00:00.000Z'))).status).toBe(200);
  expect((await state()).observation!.windows[0].usedPercent).toBe(23.5);
  const cached = (await connector.refresh()).observation!;
  expect(cached.observedAt).toBe(first.observedAt);
  expect(cached.windows).toEqual(first.windows);
  await post('providers/claude/disconnect');
  expect((await post('claude-desktop/reading', payload(99))).status).toBe(409);
  expect((await state()).enabled).toBe(false);
  expect((await state()).observation!.id).toBe(first.id);
});

it('retains localhost protections, strict quota schemas, body bounds and previous evidence', async () => {
  const { root, app, post, connect, state } = await fixture();
  await connect();
  await post('claude-desktop/reading', payload());
  const first = (await state()).observation!;
  for (const origin of ['https://untrusted.example', 'null', `chrome-extension://${'a'.repeat(32)}`]) {
    expect((await post('claude-desktop/reading', payload(), { Origin: origin })).status).toBe(403);
  }
  expect((await post('claude-desktop/reading', payload(), { 'X-AI-Usage-Tracker': '' })).status).toBe(403);
  const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const request = http.request(`${app.url}/api/claude-desktop/reading`, { method: 'POST', headers: {
      Host: 'untrusted.example', 'Content-Type': 'application/json', 'X-AI-Usage-Tracker': '1',
    } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end(JSON.stringify(payload()));
  });
  expect(badHostStatus).toBe(403);
  for (const input of [{ ...payload(), prompt: 'synthetic-private-marker' }, { ...payload(), rateLimits: [] },
    { ...payload(), sentAt: '2000-01-01T00:00:00.000Z' }, { ...payload(), rateLimits: [payload().rateLimits[0], payload().rateLimits[0]] }, payload(-1)]) {
    expect((await post('claude-desktop/reading', input)).status).toBe(422);
  }
  expect((await post('claude-desktop/reading', { extra: 'x'.repeat(9000) })).status).toBe(413);
  expect((await state()).observation!.id).toBe(first.id);
  expect(await readFile(join(root, 'local', 'claude-desktop-inbox.json'), 'utf8')).not.toContain('synthetic-private-marker');
});

it('keeps absent resets unknown and reports each supported allowance separately', () => {
  const reading = parseClaudeDesktop({ ...payload(), rateLimits: [
    { kind: 'seven_day', percentUsed: 0 }, { kind: 'spend_limit', percentUsed: 110 },
  ] });
  expect(reading.windows).toHaveLength(2);
  expect(reading.windows[0].resetAt).toBeNull();
  expect(reading.windows[1]).toMatchObject({ usedPercent: 110, used: null, limit: null, durationMinutes: null });
});
