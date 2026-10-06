import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { ConnectorResult, ProviderConnector, QuotaWindow } from '../../shared/schema.ts';
import { instant, invalidPayload, number, object, observation } from './normalize.ts';
import { ConnectorError } from './errors.ts';

const DASHBOARD = 'https://cursor.com/dashboard?tab=usage';
const USAGE_ENDPOINT = 'https://cursor.com/api/usage-summary';
const verificationDetail = 'Experimental source; reconcile its units and pool labels with the Cursor Spending dashboard. Amounts are converted from reported cents to USD.';

export function cursorSignInMessage(url: string): string {
  try {
    if (new URL(url).hostname === 'accounts.google.com') return 'Google can block sign-in in this automation-controlled browser. Select Open Cursor Sign-In again, then Continue with email using your existing Cursor account email. Do not change Google security settings. If your account requires Google or SSO, use your ordinary browser to view usage; this connector cannot complete that login.';
  } catch { /* An absent or invalid location never supplies quota or diagnostic URLs. */ }
  return 'Finish signing in to Cursor with Continue with email in its private window, then select Refresh. Use the email of your existing Cursor account.';
}

export function parseCursorPayload(payload: unknown, now?: string) {
  const data = object(payload);
  const resetAt = instant(data.billingCycleEnd);
  const cycleStart = instant(data.billingCycleStart);
  const cycleId = cycleStart || resetAt ? `${cycleStart ?? 'unknown'}|${resetAt ?? 'unknown'}` : null;
  const windows: QuotaWindow[] = [];
  const moneyPool = (value: unknown, key: string, label: string, kind: 'quota' | 'spend', scope: 'personal' | 'team') => {
    const pool = object(value);
    if (!['used', 'limit', 'totalPercentUsed'].some(field => Object.hasOwn(pool, field))) throw invalidPayload();
    const usedCents = number(pool.used);
    const limitCents = number(pool.limit);
    const reportedPercent = number(pool.totalPercentUsed);
    const usedPercent = reportedPercent ?? (usedCents !== null && limitCents !== null && limitCents > 0 ? number(usedCents / limitCents * 100) : null);
    // Components have no verified independent denominator. Preserve them as context,
    // never as separate free allowances, derived remaining balances, or warnings.
    const autoPercent = number(pool.autoPercentUsed);
    const apiPercent = number(pool.apiPercentUsed);
    const componentDetail = autoPercent !== null || apiPercent !== null
      ? ` Reported components: Auto ${autoPercent ?? 'unknown'}%; API ${apiPercent ?? 'unknown'}%. These are not additional allowances.` : '';
    const overlapDetail = key === 'individual-overall' ? ' This overall cap may overlap included plan usage.' : '';
    windows.push({ key, label, kind, scope, usedPercent, used: usedCents === null ? null : usedCents / 100,
      limit: limitCents === null ? null : limitCents / 100, unit: 'USD', resetAt, durationMinutes: null, cycleId,
      detail: verificationDetail + componentDetail + overlapDetail });
  };
  if (data.individualUsage != null) {
    const individual = object(data.individualUsage);
    if (individual.plan != null) moneyPool(individual.plan, 'individual-plan', 'Included Plan Usage', 'quota', 'personal');
    if (individual.overall != null) moneyPool(individual.overall, 'individual-overall', 'Individual Overall Allowance', 'quota', 'personal');
    if (individual.onDemand != null) moneyPool(individual.onDemand, 'individual-on-demand', 'On-Demand Spend', 'spend', 'personal');
  }
  if (data.teamUsage != null) {
    const team = object(data.teamUsage);
    if (team.pooled != null) moneyPool(team.pooled, 'team-pooled', 'Shared Team Pool', 'quota', 'team');
    if (team.onDemand != null) moneyPool(team.onDemand, 'team-on-demand', 'Team On-Demand Spend', 'spend', 'team');
  }
  if (!windows.length) throw invalidPayload();
  return observation('cursor', 'cursor-browser', windows, now);
}

/** Runs inside the dedicated page. Only allowlisted quota fields cross into Node. */
export async function requestCursorQuotaInPage() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('https://cursor.com/api/usage-summary', { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
    if ([401, 403].includes(response.status)) return { kind: 'signed-out' as const };
    if (!response.ok || response.url !== 'https://cursor.com/api/usage-summary') return { kind: 'unavailable' as const };
    if (!response.headers.get('content-type')?.includes('application/json')) return { kind: 'signed-out' as const };
    if (Number(response.headers.get('content-length')) > 1_000_000) return { kind: 'too-large' as const };
    const reader = response.body?.getReader();
    if (!reader) return { kind: 'unavailable' as const };
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1_000_000) { await reader.cancel(); return { kind: 'too-large' as const }; }
      chunks.push(chunk.value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    const data: unknown = JSON.parse(new TextDecoder().decode(buffer));
    const object = (value: unknown): Record<string, unknown> => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('format');
      return value as Record<string, unknown>;
    };
    const source = object(data);
    const result: Record<string, unknown> = {};
    for (const field of ['billingCycleStart', 'billingCycleEnd']) {
      if (!Object.hasOwn(source, field)) continue;
      const value = source[field];
      if (value != null && (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error('format');
      result[field] = value;
    }
    for (const [group, pools] of [['individualUsage', ['plan', 'overall', 'onDemand']], ['teamUsage', ['pooled', 'onDemand']]] as const) {
      if (source[group] == null) continue;
      const sourceGroup = object(source[group]);
      const groupResult: Record<string, unknown> = {};
      for (const pool of pools) {
        if (sourceGroup[pool] == null) continue;
        const sourcePool = object(sourceGroup[pool]);
        const poolResult: Record<string, unknown> = {};
        for (const field of ['used', 'limit', 'totalPercentUsed', 'autoPercentUsed', 'apiPercentUsed']) {
          if (!Object.hasOwn(sourcePool, field)) continue;
          const value = sourcePool[field];
          if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('format');
          poolResult[field] = value;
        }
        groupResult[pool] = poolResult;
      }
      result[group] = groupResult;
    }
    return { kind: 'ok' as const, payload: result };
  } catch { return { kind: 'unavailable' as const }; }
  finally { clearTimeout(timer); }
}

export async function resolveChromeExecutable(): Promise<string> {
  const candidates = process.platform === 'win32' ? [
    join(process.env.ProgramFiles || 'C:/Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch { /* Continue only through known Chrome paths. */ } }
  throw new ConnectorError('CHROME_NOT_INSTALLED', 'Google Chrome was not found. Install Chrome to use the dedicated Cursor sign-in window.');
}

export class CursorConnector implements ProviderConnector {
  private root: string;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(root: string) { this.root = root; }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }
  connect(): Promise<ConnectorResult> { return this.serial(async () => {
    if (!this.context) {
      const executablePath = await resolveChromeExecutable();
      const profile = join(this.root, 'local', 'browser-profiles', 'cursor');
      await mkdir(profile, { recursive: true });
      try {
        this.context = await chromium.launchPersistentContext(profile, { executablePath, headless: false,
          timeout: 20_000, viewport: { width: 1100, height: 800 }, acceptDownloads: false });
        this.context.on('close', () => { this.context = null; this.page = null; });
      } catch { throw new ConnectorError('CURSOR_BROWSER_UNAVAILABLE', 'The private Cursor browser could not open. Close any previous tracker sign-in window, then reconnect.'); }
    }
    try {
      this.page = this.context.pages().find(page => page.url().startsWith('https://cursor.com/')) ?? await this.context.newPage();
      await this.page.goto(DASHBOARD, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      await this.page.bringToFront();
    } catch { /* Keep the visible sign-in window; the user can finish provider challenges. */ }
    return { observation: null, waiting: true, verified: false,
      message: 'A private Cursor window is open. Choose Continue with email using your existing Cursor account email, complete its sign-in, then select Refresh here. Google may block this automation-controlled browser; do not change your Google security settings.' };
  }); }
  refresh(): Promise<ConnectorResult> { return this.serial(async () => {
    if (!this.context) return { observation: null, waiting: true, verified: false,
      message: 'Reconnect Cursor to open its private browser session, then sign in and select Refresh.' };
    let page = this.page;
    if (!page || page.isClosed()) page = this.context.pages().find(candidate => candidate.url().startsWith('https://cursor.com/')) ?? null;
    if (!page || new URL(page.url()).origin !== new URL(USAGE_ENDPOINT).origin) return { observation: null, waiting: true, verified: false,
      message: cursorSignInMessage(page?.url() ?? '') };
    this.page = page;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([page.evaluate(requestCursorQuotaInPage), new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          void page?.close().catch(() => {});
          reject(new ConnectorError('CURSOR_TIMEOUT', 'Cursor did not return quota before the deadline. Reconnect its private browser, then retry.'));
        }, 20_000);
      })]);
      if (result.kind === 'signed-out') return { observation: null, waiting: true, verified: false,
        message: 'Cursor requires sign-in or a challenge. Complete it in the private window, then select Refresh; your previous quota is kept.' };
      if (result.kind === 'too-large') throw new ConnectorError('QUOTA_RESPONSE_TOO_LARGE', 'Cursor exceeded the quota response size limit. Your previous observation is preserved.');
      if (result.kind !== 'ok') throw new ConnectorError('CURSOR_QUOTA_UNAVAILABLE', 'Cursor quota could not be read. Check the private window, then retry Refresh.');
      return { observation: parseCursorPayload(result.payload), verified: false,
        message: 'Read Cursor usage through the private browser. This undocumented connector is experimental; compare its meters with Spending.' };
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError('CURSOR_QUOTA_UNAVAILABLE', 'Cursor quota could not be read. Reconnect its private browser and try again.');
    } finally { clearTimeout(deadline); }
  }); }
  disconnect(): Promise<void> { return this.serial(async () => {
    const context = this.context; this.context = null; this.page = null;
    await context?.close().catch(() => {});
  }); }
  close(): Promise<void> { return this.disconnect(); }
}
