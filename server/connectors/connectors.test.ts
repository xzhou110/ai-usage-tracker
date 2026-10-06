import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObservationSchema } from '../../shared/schema.ts';
import { CodexConnector, codexAvailabilityMessage, parseCodexPayload } from './codex.ts';
import { ClaudeConnector } from './claude.ts';
import { parseCursorPayload } from './cursor.ts';
import { ConnectorError } from './errors.ts';
import { projectClaudeInput, writeClaudeProjection } from '../../tools/claude-statusline-bridge.mjs';

const roots: string[] = [];
const now = '2026-10-05T19:00:00.000Z';
const later = '2026-10-05T19:05:00.000Z';
async function temporary() { const root = await mkdtemp(join(tmpdir(), 'ai-usage-tracker-test-')); roots.push(root); return root; }
afterEach(async () => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe('Codex Quota Projection', () => {
  it('prefers every bucket in the map and preserves consumption direction, overage, dates, and duration labels', () => {
    const result = parseCodexPayload({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: {
      codex: { primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: { usedPercent: 125, windowDurationMins: 10080 } },
      'synthetic-private-account-marker': { primary: { usedPercent: 0.36 } },
    }, email: 'synthetic-private-marker', conversations: ['synthetic-private-marker'] }, now);
    expect(result.windows).toHaveLength(3);
    expect(result.windows.map(window => window.usedPercent)).toEqual([0, 125, 0.36]);
    expect(result.windows[0]).toMatchObject({ label: 'Codex 5-Hour Limit', resetAt: '2027-01-15T08:00:00.000Z', used: null, limit: null });
    expect(result.windows[1]).toMatchObject({ label: 'Codex Weekly Limit', resetAt: null });
    expect(JSON.stringify(result)).not.toContain('synthetic-private');
    expect(ObservationSchema.safeParse(result).success).toBe(true);
  });
  it('keeps unknown bucket history keys stable when other buckets are added or removed', () => {
    const one = parseCodexPayload({ rateLimitsByLimitId: { z: { primary: { usedPercent: 2 } } } });
    const two = parseCodexPayload({ rateLimitsByLimitId: { a: { primary: { usedPercent: 3 } }, z: { primary: { usedPercent: 2 } } } });
    expect(two.windows.find(window => window.usedPercent === 2)?.key).toBe(one.windows[0].key);
  });
  it('does not replace unknown values with zeros or copy credit/identity fields', () => {
    const result = parseCodexPayload({ rateLimits: { primary: {}, credits: { balance: 'synthetic-private-marker' } } });
    expect(result.windows[0]).toMatchObject({ usedPercent: null, resetAt: null, durationMinutes: null });
    expect(JSON.stringify(result)).not.toContain('synthetic-private-marker');
  });
  it('preserves an individual spending limit without inventing monetary units and reports binding restrictions', () => {
    const input = { ordinaryUsageAllowed: false, rateLimits: { primary: { usedPercent: 1 }, spendControlReached: true,
      individualLimit: { used: 'synthetic-private-marker', limit: 'synthetic-private-marker', remainingPercent: 20, resetsAt: 1800000000 } } };
    const result = parseCodexPayload(input);
    expect(result.windows[1]).toMatchObject({ label: 'Codex Individual Spend Limit', usedPercent: 80, used: null, limit: null, unit: null, resetAt: '2027-01-15T08:00:00.000Z' });
    expect(JSON.stringify(result)).not.toContain('synthetic-private-marker');
    expect(codexAvailabilityMessage(input)).toContain('ordinary usage is unavailable and a spending control');
    expect(codexAvailabilityMessage({ ...input, ordinaryUsageAllowed: true })).toContain('spending control has been reached');
  });
  it.each([{}, { rateLimitsByLimitId: {}, rateLimits: { primary: { usedPercent: 12 } } }, { rateLimits: { primary: { usedPercent: '12' } } },
    { rateLimits: { primary: { usedPercent: -1 } } }, { rateLimits: { primary: { usedPercent: Infinity } } }, { rateLimits: { primary: { resetsAt: 1e200 } } },
    { rateLimits: { primary: [] } }, { rateLimits: {} }])('rejects malformed or unsupported data without source text %#', payload => {
    expect(() => parseCodexPayload(payload)).toThrow(ConnectorError);
  });
});

function fakeCodex(handler: (message: Record<string, unknown>, output: PassThrough) => void) {
  const process = new EventEmitter() as ChildProcessWithoutNullStreams;
  process.stdin = new PassThrough(); process.stdout = new PassThrough(); process.stderr = new PassThrough();
  process.kill = vi.fn(() => true);
  const messages: Record<string, unknown>[] = [];
  let incoming = '';
  process.stdin.on('data', chunk => {
    incoming += String(chunk);
    while (incoming.includes('\n')) {
      const boundary = incoming.indexOf('\n'); const message = JSON.parse(incoming.slice(0, boundary)); incoming = incoming.slice(boundary + 1);
      messages.push(message); queueMicrotask(() => handler(message, process.stdout as PassThrough));
    }
  });
  return { process, messages };
}

describe('Codex Read-Only Transport', () => {
  it('allows exactly the initialization and quota handshake, ignores unrelated notifications, and closes its process', async () => {
    const fake = fakeCodex((message, output) => {
      if (message.id === 1) output.write(JSON.stringify({ id: 1, result: { userAgent: 'synthetic-private-marker' } }) + '\n');
      if (message.id === 2) {
        output.write(JSON.stringify({ method: 'unrelated', params: { text: 'synthetic-private-marker' } }) + '\n');
        output.write(JSON.stringify({ id: 2, result: { rateLimits: { primary: { usedPercent: 25 } } } }) + '\n');
      }
    });
    const connector = new CodexConnector({ resolver: async () => 'synthetic', launch: () => fake.process });
    const result = await connector.connect();
    expect(fake.messages.map(message => message.method)).toEqual(['initialize', 'initialized', 'account/rateLimits/read']);
    expect(result.observation?.windows[0].usedPercent).toBe(25);
    expect(JSON.stringify(result)).not.toContain('synthetic-private-marker');
    expect(fake.process.kill).toHaveBeenCalled();
  });
  it('does not continue after an initialization error or relay native errors', async () => {
    const fake = fakeCodex((message, output) => output.write(JSON.stringify({ id: message.id, error: { message: 'synthetic-private-marker' } }) + '\n'));
    const connector = new CodexConnector({ resolver: async () => 'synthetic', launch: () => fake.process });
    await expect(connector.connect()).rejects.toMatchObject({ code: 'CODEX_INITIALIZE_FAILED' });
    expect(fake.messages).toHaveLength(1);
  });
  it('bounds response bytes and deadlines and kills failed children', async () => {
    const large = fakeCodex((_, output) => output.write('x'.repeat(2_000_001)));
    await expect(new CodexConnector({ resolver: async () => 'synthetic', launch: () => large.process }).refresh()).rejects.toMatchObject({ code: 'QUOTA_RESPONSE_TOO_LARGE' });
    const silent = fakeCodex(() => {});
    await expect(new CodexConnector({ resolver: async () => 'synthetic', launch: () => silent.process, deadline: 10 }).refresh()).rejects.toMatchObject({ code: 'CODEX_TIMEOUT' });
    expect(large.process.kill).toHaveBeenCalled(); expect(silent.process.kill).toHaveBeenCalled();
  });
  it('cancels an in-progress executable lookup before it can spawn and refuses overlapping refreshes', async () => {
    let release!: (value: string) => void;
    const launch = vi.fn();
    const connector = new CodexConnector({ resolver: () => new Promise(resolve => { release = resolve; }), launch });
    const pending = connector.refresh();
    await expect(connector.refresh()).rejects.toMatchObject({ code: 'REFRESH_IN_PROGRESS' });
    await connector.close(); release('synthetic');
    await expect(pending).rejects.toMatchObject({ code: 'REFRESH_CANCELLED' });
    expect(launch).not.toHaveBeenCalled();
  });
});

describe('Claude Passive Freshness and Privacy', () => {
  const input = { rate_limits: { five_hour: { used_percentage: 42, resets_at: 1800000000 }, seven_day: { used_percentage: 10, resets_at: 1800500000 } },
    session_id: 'synthetic-private-marker', transcript_path: 'synthetic-private-marker', model: { id: 'synthetic-private-marker' } };
  it('persists only quota, keeps observation time/id unchanged for duplicates, and updates receipt time', async () => {
    const root = await temporary();
    expect(await writeClaudeProjection(root, input, now)).toEqual({ changed: true, written: true });
    const first = JSON.parse(await readFile(join(root, 'local', 'claude-inbox.json'), 'utf8'));
    expect(await writeClaudeProjection(root, { ...input, session_id: 'changed-unrelated-input' }, later)).toEqual({ changed: false, written: true });
    const text = await readFile(join(root, 'local', 'claude-inbox.json'), 'utf8'); const second = JSON.parse(text);
    expect(second).toMatchObject({ id: first.id, observedAt: now, receivedAt: later });
    expect(text).not.toContain('synthetic-private-marker'); expect(text).not.toContain('session_id'); expect(text).not.toContain('changed-unrelated-input');
    expect(ObservationSchema.safeParse(second).success).toBe(true);
    expect(await readdir(join(root, 'local'))).toEqual(['claude-inbox.json']);
  });
  it('missing rate_limits never erases or freshens the previous observation', async () => {
    const root = await temporary(); await writeClaudeProjection(root, input, now);
    const before = await readFile(join(root, 'local', 'claude-inbox.json'), 'utf8');
    expect(await writeClaudeProjection(root, { context_window: { used_percentage: 0 } }, later)).toEqual({ changed: false, written: false });
    expect(await readFile(join(root, 'local', 'claude-inbox.json'), 'utf8')).toBe(before);
  });
  it('valid replacement removes missing windows so an old window is never newly fresh; an empty block is unknown, not zero', async () => {
    const root = await temporary(); await writeClaudeProjection(root, input, now);
    await writeClaudeProjection(root, { rate_limits: { seven_day: input.rate_limits.seven_day } }, later);
    let saved = JSON.parse(await readFile(join(root, 'local', 'claude-inbox.json'), 'utf8'));
    expect(saved.windows.map((window: { key: string }) => window.key)).toEqual(['seven_day']);
    expect(saved.observedAt).toBe(later);
    await writeClaudeProjection(root, { rate_limits: {} }, later);
    saved = JSON.parse(await readFile(join(root, 'local', 'claude-inbox.json'), 'utf8'));
    expect(saved.windows).toEqual([]);
  });
  it('does not treat context usage as quota and rejects malformed quota without retaining raw input', () => {
    expect(projectClaudeInput({ context_window: { used_percentage: 100 } })).toBeNull();
    expect(() => projectClaudeInput({ rate_limits: { five_hour: { used_percentage: 'synthetic-private-marker' } } })).toThrow('Unsupported Claude quota format.');
    expect(projectClaudeInput({ rate_limits: { five_hour: {} } })?.[0].usedPercent).toBeNull();
  });
  it('preserves a corrupt inbox for recovery', async () => {
    const root = await temporary(); await mkdir(join(root, 'local'));
    await writeFile(join(root, 'local', 'claude-inbox.json'), '{broken');
    await expect(writeClaudeProjection(root, input, now)).rejects.toThrow('could not be read safely');
    expect(await readFile(join(root, 'local', 'claude-inbox.json'), 'utf8')).toBe('{broken');
  });
});

describe('Claude Reversible Settings Integration', () => {
  async function setup(original: unknown) {
    const root = await temporary(); const settingsPath = join(root, 'native-settings.json');
    await writeFile(settingsPath, JSON.stringify(original));
    return { root, settingsPath, connector: new ClaudeConnector(root, settingsPath) };
  }
  it('preserves existing command, padding, refresh interval, other settings, and restores only its own wrapper', async () => {
    const original = { theme: 'dark', statusLine: { type: 'command', command: 'echo original', padding: 3, refreshInterval: 12 } };
    const { root, settingsPath, connector } = await setup(original);
    expect((await connector.connect()).waiting).toBe(true);
    const installed = JSON.parse(await readFile(settingsPath, 'utf8'));
    expect(installed).toMatchObject({ theme: 'dark', statusLine: { padding: 3, refreshInterval: 12 } });
    expect(installed.statusLine.command).toContain('claude-statusline-bridge.mjs');
    const backup = JSON.parse(await readFile(join(root, 'local', 'claude-statusline-backup.json'), 'utf8'));
    expect(backup.statusLine).toEqual(original.statusLine);
    await connector.connect();
    expect(JSON.parse(await readFile(join(root, 'local', 'claude-statusline-backup.json'), 'utf8')).statusLine).toEqual(original.statusLine);
    await connector.disconnect();
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual(original);
  });
  it('restores an originally absent status line while preserving unrelated edits', async () => {
    const { settingsPath, connector } = await setup({ theme: 'dark' });
    await connector.connect();
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')); settings.theme = 'light';
    await writeFile(settingsPath, JSON.stringify(settings));
    await connector.disconnect();
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ theme: 'light' });
  });
  it('does not clobber a user-edited command or padding and retains the original backup', async () => {
    const { root, settingsPath, connector } = await setup({ statusLine: { type: 'command', command: 'echo original', padding: 2 } });
    await connector.connect();
    const changed = { statusLine: { type: 'command', command: 'echo user-edited', padding: 5 } };
    await writeFile(settingsPath, JSON.stringify(changed));
    await expect(connector.disconnect()).rejects.toMatchObject({ code: 'CLAUDE_SETTINGS_CHANGED' });
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual(changed);
    expect(JSON.parse(await readFile(join(root, 'local', 'claude-statusline-backup.json'), 'utf8')).statusLine.command).toBe('echo original');
  });
  it('refuses recursive wrapping and leaves invalid native settings untouched', async () => {
    const { settingsPath, connector } = await setup({ statusLine: { type: 'command', command: 'node /old/claude-statusline-bridge.mjs' } });
    const before = await readFile(settingsPath, 'utf8');
    await expect(connector.connect()).rejects.toMatchObject({ code: 'CLAUDE_BRIDGE_ALREADY_INSTALLED' });
    expect(await readFile(settingsPath, 'utf8')).toBe(before);
    await writeFile(settingsPath, '{broken');
    await expect(connector.connect()).rejects.toMatchObject({ code: 'CLAUDE_SETTINGS_UNAVAILABLE' });
    expect(await readFile(settingsPath, 'utf8')).toBe('{broken');
    await expect(connector.refresh()).rejects.toMatchObject({ code: 'CLAUDE_BRIDGE_NOT_CONNECTED' });
  });
  it('does not import an old inbox as a connected source after the wrapper changes', async () => {
    const { root, settingsPath, connector } = await setup({ statusLine: { type: 'command', command: 'echo original' } });
    await connector.connect();
    await writeClaudeProjection(root, { rate_limits: { five_hour: { used_percentage: 22 } } }, now);
    await writeFile(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'echo changed' } }));
    await expect(connector.refresh()).rejects.toMatchObject({ code: 'CLAUDE_SETTINGS_CHANGED' });
  });
  it('forwards original stdin bytes, stdout, stderr and exit behavior through the real installed shell', async () => {
    const root = await temporary(); await mkdir(join(root, 'tools')); await mkdir(join(root, 'local'));
    const bridgePath = join(root, 'tools', 'claude-statusline-bridge.mjs');
    await copyFile(fileURLToPath(new URL('../../tools/claude-statusline-bridge.mjs', import.meta.url)), bridgePath);
    const originalPath = join(root, 'original.mjs');
    await writeFile(originalPath, "const parts=[];for await(const chunk of process.stdin)parts.push(chunk);process.stdout.write(Buffer.concat(parts));process.stderr.write('original-stderr');process.exitCode=7;");
    const command = `"${process.execPath.replaceAll('\\', '/')}" "${originalPath.replaceAll('\\', '/')}"`;
    await writeFile(join(root, 'local', 'claude-statusline-backup.json'), JSON.stringify({ active: true, statusLine: { command } }));
    const input = Buffer.from('{"rate_limits":{"five_hour":{"used_percentage":12}},"private_note":"synthetic-private-marker"}\r\n');
    const result = await new Promise<{ code: number | null; stdout: Buffer; stderr: string }>((resolveResult, reject) => {
      const child = spawn(process.execPath, [bridgePath], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout: Buffer[] = []; let stderr = '';
      child.stdout.on('data', chunk => stdout.push(chunk)); child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', reject); child.once('close', code => resolveResult({ code, stdout: Buffer.concat(stdout), stderr }));
      child.stdin.end(input);
    });
    expect(result.code).toBe(7); expect(result.stdout.equals(input)).toBe(true); expect(result.stderr).toBe('original-stderr');
    expect(await readFile(join(root, 'local', 'claude-inbox.json'), 'utf8')).not.toContain('synthetic-private-marker');
  }, 15_000);
});

describe('Cursor Experimental Quota Projection', () => {
  it('keeps every real pool separate, converts cents once, preserves fractional percent and excludes identities', () => {
    const result = parseCursorPayload({ billingCycleStart: '2026-10-01T00:00:00Z', billingCycleEnd: '2026-11-01T00:00:00Z',
      individualUsage: { plan: { used: 72, limit: 20000, totalPercentUsed: 0.36, autoPercentUsed: 0.2, apiPercentUsed: 0.16 },
        overall: { used: 100, limit: 50000 }, onDemand: { used: 1234, limit: null } },
      teamUsage: { pooled: { used: 2500, limit: 10000 }, onDemand: { used: 100, limit: 2000 } },
      accountName: 'synthetic-private-marker', membershipType: 'synthetic-private-marker' }, now);
    expect(result.windows).toHaveLength(5);
    expect(result.windows[0]).toMatchObject({ usedPercent: 0.36, used: 0.72, limit: 200, unit: 'USD', resetAt: '2026-11-01T00:00:00.000Z' });
    expect(result.windows[0].detail).toContain('Auto 0.2%; API 0.16%');
    expect(result.windows.some(window => window.key.includes('PercentUsed'))).toBe(false);
    expect(result.windows[2]).toMatchObject({ kind: 'spend', used: 12.34, limit: null, usedPercent: null });
    expect(result.windows[3]).toMatchObject({ scope: 'team', usedPercent: 25 });
    expect(JSON.stringify(result)).not.toContain('synthetic-private-marker');
    expect(ObservationSchema.safeParse(result).success).toBe(true);
  });
  it('preserves unknown amounts and dates and avoids dividing by a zero denominator', () => {
    expect(parseCursorPayload({ individualUsage: { plan: { used: null, limit: 0 } } }).windows[0]).toMatchObject({ used: null, usedPercent: null, limit: 0, resetAt: null, cycleId: null });
    expect(parseCursorPayload({ individualUsage: { plan: { used: 300, limit: 100 } } }).windows[0].usedPercent).toBe(300);
  });
  it.each([{}, { individualUsage: { plan: {} } }, { individualUsage: { plan: { autoPercentUsed: 20, apiPercentUsed: 40 } } },
    { individualUsage: { plan: { used: '0' } } }, { individualUsage: { plan: { used: -1 } } },
    { billingCycleEnd: 'tomorrow', individualUsage: { plan: { used: 0 } } },
    { billingCycleEnd: '2026-02-30T00:00:00Z', individualUsage: { plan: { used: 0 } } },
    { individualUsage: { plan: { used: 1e308, limit: 1e-308 } } }])('rejects unsupported or ambiguous data without inventing allowances %#', input => {
    expect(() => parseCursorPayload(input)).toThrow(ConnectorError);
  });
});
