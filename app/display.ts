import type { Observation, ProviderState, QuotaWindow } from '../shared/schema';

export const sourceNames: Record<Observation['source'], string> = {
  'codex-app-server': 'Installed Codex Account',
  'claude-statusline': 'Claude Code Status Line',
  'claude-desktop-mod': 'Claude Desktop Code Bridge',
  'cursor-browser': 'Cursor Usage Page',
};

export function percentage(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value) + '%';
}

export function remaining(used: number | null): number | null {
  return used === null ? null : Math.max(0, 100 - used);
}

export function resetPassed(window: QuotaWindow, now: number): boolean {
  return window.resetAt !== null && Date.parse(window.resetAt) <= now;
}

export function countdown(at: string | null, now: number): string {
  if (!at || !Number.isFinite(Date.parse(at))) return 'Reset Time Unknown';
  const milliseconds = Date.parse(at) - now;
  if (milliseconds <= 0) return 'Awaiting Confirmation';
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return `${hours}h ${remainder}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function dateTime(at: string | null, timezone: string, withYear = false): string {
  if (!at || !Number.isFinite(Date.parse(at))) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, month: 'short', day: 'numeric',
    ...(withYear ? { year: 'numeric' as const } : {}),
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(at));
}

export function relativeTime(at: string | null, now: number): string {
  if (!at) return 'Never';
  const minutes = Math.floor(Math.max(0, now - Date.parse(at)) / 60_000);
  if (minutes < 1) return 'Just Now';
  if (minutes < 60) return `${minutes}m Ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h Ago`;
  return `${Math.floor(minutes / 1_440)}d Ago`;
}

export function nativeAmount(window: QuotaWindow): string | null {
  if (window.used === null) return null;
  const format = (value: number) => window.unit === 'USD'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  const unit = window.unit && window.unit !== 'USD' ? ` ${window.unit === 'percent' ? '%' : window.unit}` : '';
  return `${format(window.used)}${window.limit === null ? '' : ` of ${format(window.limit)}`}${unit}`;
}

export function providerHealth(provider: ProviderState, now: number, staleAfterMinutes: number): { label: string; tone: string } {
  if (provider.status === 'disconnected') return { label: 'Disconnected', tone: 'neutral' };
  if (provider.status === 'connecting') return { label: 'Connecting', tone: 'accent' };
  if (provider.status === 'error') return { label: 'Needs Attention', tone: 'danger' };
  if (provider.status === 'waiting' || !provider.observation) return { label: 'Waiting for Reading', tone: 'warning' };
  if (provider.observation.windows.some(window => window.kind === 'quota' && resetPassed(window, now))) return { label: 'Confirm Reset', tone: 'warning' };
  if (provider.freshness === 'stale' || now - Date.parse(provider.observation.observedAt) > staleAfterMinutes * 60_000) return { label: 'Stale Reading', tone: 'warning' };
  if (provider.freshness === 'unknown') return { label: 'Freshness Unknown', tone: 'neutral' };
  return { label: 'Current', tone: 'good' };
}

export function mergeObservations(previous: Observation[], latest: Observation[]): Observation[] {
  const records = new Map(previous.map(record => [record.id, record]));
  for (const record of latest) records.set(record.id, record);
  return [...records.values()].sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.id.localeCompare(a.id));
}
