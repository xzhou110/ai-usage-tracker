import type { ConnectorResult, ProviderConnector, QuotaWindow } from '../../shared/schema.ts';
import { instant, invalidPayload, number, object, observation } from './normalize.ts';
import { CursorBrowserBridge } from './cursor-browser.ts';

const verificationDetail = 'Experimental source; reconcile its units and pool labels with the Cursor Spending dashboard. Amounts are converted from reported cents to USD.';
export const CURSOR_BROWSER_GUIDANCE = 'Keep the Cursor dashboard open in your normal browser with the paired AI Usage Tracker extension. Use Sync Now in the extension for a new reading. The tracker never opens an automated login window.';

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


export class CursorConnector implements ProviderConnector {
  readonly browser: CursorBrowserBridge;
  constructor(root: string) { this.browser = new CursorBrowserBridge(root); }
  async connect(): Promise<ConnectorResult> {
    return this.refresh();
  }
  async refresh(): Promise<ConnectorResult> {
    const saved = await this.browser.current();
    return { observation: saved.observation, waiting: !saved.tokenHash || !saved.observation, verified: false,
      message: saved.tokenHash ? CURSOR_BROWSER_GUIDANCE : 'Install the Cursor browser extension and pair it in Connection Details. Complete sign-in only in your normal browser.' };
  }
  async disconnect(): Promise<void> { await this.browser.disconnect(); }
  async close(): Promise<void> {}
}
