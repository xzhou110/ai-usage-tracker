import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readdir } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type { ConnectorResult, ProviderConnector, QuotaWindow } from '../../shared/schema.ts';
import { epoch, invalidPayload, number, object, observation } from './normalize.ts';
import { ConnectorError } from './errors.ts';

const safeBuckets: Record<string, string> = { codex: 'Codex', 'codex-mini': 'Codex Mini', 'gpt-5-codex': 'GPT-5 Codex', 'gpt-5.1-codex': 'GPT-5.1 Codex', 'gpt-5.2-codex': 'GPT-5.2 Codex', 'gpt-5.3-codex': 'GPT-5.3 Codex' };

export function parseCodexPayload(payload: unknown, now?: string) {
  const data = object(payload);
  let buckets: [string, unknown][];
  if (data.rateLimitsByLimitId != null) buckets = Object.entries(object(data.rateLimitsByLimitId)).sort(([a], [b]) => a.localeCompare(b));
  else if (data.rateLimits != null) buckets = [['codex', data.rateLimits]];
  else throw invalidPayload();
  if (!buckets.length) throw invalidPayload();
  const windows: QuotaWindow[] = [];
  buckets.forEach(([nativeKey, value], index) => {
    const bucket = object(value);
    // Unknown names can carry account identity; preserve their windows with neutral labels.
    const known = Object.hasOwn(safeBuckets, nativeKey);
    const label = known ? safeBuckets[nativeKey] : `Quota Bucket ${index + 1}`;
    const key = known ? nativeKey : `bucket-${createHash('sha256').update(nativeKey).digest('hex').slice(0, 24)}`;
    for (const name of ['primary', 'secondary'] as const) {
      if (bucket[name] == null) continue;
      const window = object(bucket[name]);
      const resetAt = epoch(window.resetsAt);
      const durationMinutes = number(window.windowDurationMins);
      const durationLabel = durationMinutes === 10080 ? 'Weekly Limit' : durationMinutes !== null && durationMinutes > 0
        ? durationMinutes % 60 === 0 ? `${durationMinutes / 60}-Hour Limit` : `${durationMinutes}-Minute Limit`
        : `${name === 'primary' ? 'Primary' : 'Secondary'} Limit`;
      windows.push({ key: `${key}-${name}`, label: `${label} ${durationLabel}`, kind: 'quota', scope: 'unknown',
        usedPercent: number(window.usedPercent), used: null, limit: null, unit: 'percent', resetAt,
        durationMinutes, cycleId: resetAt,
        detail: known ? null : 'The source bucket name is hidden to avoid exposing account identifiers.' });
    }
    if (bucket.individualLimit != null) {
      const individual = object(bucket.individualLimit);
      const remainingPercent = number(individual.remainingPercent);
      if (remainingPercent !== null && remainingPercent > 100) throw invalidPayload();
      const resetAt = epoch(individual.resetsAt);
      windows.push({ key: `${key}-individual-spend`, label: `${label} Individual Spend Limit`, kind: 'quota', scope: 'personal',
        usedPercent: remainingPercent === null ? null : 100 - remainingPercent, used: null, limit: null, unit: null,
        resetAt, durationMinutes: null, cycleId: resetAt,
        detail: 'The source reports a remaining percentage for an individual spending limit. Monetary units are unverified, so its amount strings are omitted.' });
    }
  });
  if (!windows.length) throw invalidPayload();
  return observation('codex', 'codex-app-server', windows, now);
}

export function codexAvailabilityMessage(payload: unknown): string {
  const data = object(payload);
  if (data.ordinaryUsageAllowed != null && typeof data.ordinaryUsageAllowed !== 'boolean') throw invalidPayload();
  const buckets = data.rateLimitsByLimitId != null ? Object.values(object(data.rateLimitsByLimitId)) : data.rateLimits != null ? [data.rateLimits] : [];
  let spendRestricted = false;
  for (const value of buckets) {
    const bucket = object(value);
    if (bucket.spendControlReached != null && typeof bucket.spendControlReached !== 'boolean') throw invalidPayload();
    if (bucket.spendControlReached === true) spendRestricted = true;
  }
  if (data.ordinaryUsageAllowed === false && spendRestricted) return 'Codex reports ordinary usage is unavailable and a spending control has been reached. Remaining percentages do not guarantee availability.';
  if (data.ordinaryUsageAllowed === false) return 'Codex reports ordinary usage is currently unavailable. Remaining percentages do not guarantee availability.';
  if (spendRestricted) return 'Codex reports a spending control has been reached. Remaining percentages do not guarantee availability.';
  return 'Read quota from the installed Codex account.';
}

async function executableExists(path: string) { try { await access(path); return true; } catch { return false; } }
export async function resolveCodexExecutable(): Promise<string> {
  for (const folder of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(folder.replace(/^"|"$/g, ''), process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (await executableExists(candidate)) return candidate;
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const base = join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.filter(item => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
      const candidate = join(base, entry.name, 'codex.exe');
      if (await executableExists(candidate)) return candidate;
    }
  }
  throw new ConnectorError('CODEX_NOT_INSTALLED', 'The installed Codex executable was not found. Install or open Codex, then reconnect.');
}

export class CodexConnector implements ProviderConnector {
  private child: ChildProcessWithoutNullStreams | null = null;
  private cancel: (() => void) | null = null;
  private pending = false;
  private generation = 0;
  private resolver: () => Promise<string>;
  private launch: (executable: string) => ChildProcessWithoutNullStreams;
  private deadline: number;
  constructor(options: { resolver?: () => Promise<string>; launch?: (executable: string) => ChildProcessWithoutNullStreams; deadline?: number } = {}) {
    this.resolver = options.resolver ?? resolveCodexExecutable;
    this.launch = options.launch ?? (executable => spawn(executable, ['app-server', '--stdio'], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
    this.deadline = options.deadline ?? 20_000;
  }
  async connect() { return this.refresh(); }
  async refresh(): Promise<ConnectorResult> {
    if (this.pending) throw new ConnectorError('REFRESH_IN_PROGRESS', 'A Codex refresh is already running.');
    this.pending = true;
    const generation = this.generation;
    try {
      const executable = await this.resolver();
      if (generation !== this.generation) throw new ConnectorError('REFRESH_CANCELLED', 'Codex refresh was cancelled.');
      const child = this.launch(executable);
      this.child = child;
      return await new Promise<ConnectorResult>((resolve, reject) => {
      let finished = false;
      let buffer = '';
      let bytes = 0;
      let phase = 'initializing';
      const end = (error?: Error, result?: ConnectorResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.cancel = null;
        this.child = null;
        child.stdin.destroy();
        child.kill();
        if (error) reject(error); else resolve(result!);
      };
      const timer = setTimeout(() => end(new ConnectorError('CODEX_TIMEOUT', 'Codex did not return quota before the deadline. Open Codex and check sign-in, then retry.')), this.deadline);
      this.cancel = () => end(new ConnectorError('REFRESH_CANCELLED', 'Codex refresh was cancelled.'));
      const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n');
      child.on('error', () => end(new ConnectorError('CODEX_START_FAILED', 'Codex could not be started. Open the installed app, then reconnect.')));
      child.on('close', () => end(new ConnectorError('CODEX_CLOSED', 'Codex closed before returning quota. Check its sign-in and try again.')));
      child.stdin.on('error', () => end(new ConnectorError('CODEX_CLOSED', 'The Codex quota connection closed. Try reconnecting.')));
      child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 2_000_000) end(new ConnectorError('QUOTA_RESPONSE_TOO_LARGE', 'Codex exceeded the quota response size limit.')); });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 2_000_000) { end(new ConnectorError('QUOTA_RESPONSE_TOO_LARGE', 'Codex exceeded the quota response size limit.')); return; }
        buffer += chunk;
        while (!finished && buffer.includes('\n')) {
          const boundary = buffer.indexOf('\n');
          const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
          let message: Record<string, unknown>;
          try { message = object(JSON.parse(line)); } catch { continue; }
          if (message.id === 1 && phase === 'initializing') {
            if (message.error || !message.result) { end(new ConnectorError('CODEX_INITIALIZE_FAILED', 'Codex could not initialize its quota connection.')); return; }
            phase = 'reading';
            send({ method: 'initialized', params: {} });
            send({ id: 2, method: 'account/rateLimits/read', params: null });
          } else if (message.id === 2 && phase === 'reading') {
            if (message.error) { end(new ConnectorError('CODEX_QUOTA_UNAVAILABLE', 'Codex quota is unavailable. Sign in through the installed Codex app, then reconnect.')); return; }
            try { end(undefined, { observation: parseCodexPayload(message.result), message: codexAvailabilityMessage(message.result) }); }
            catch { end(invalidPayload()); }
          }
        }
      });
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'ai_usage_tracker', title: 'AI Usage Tracker', version: '0.1.0' } } });
      });
    } finally { this.pending = false; }
  }
  async disconnect() { this.generation++; this.cancel?.(); }
  async close() { await this.disconnect(); }
}
