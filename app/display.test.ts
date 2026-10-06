import { describe, expect, it } from 'vitest';
import { countdown, dateTime, mergeObservations, nativeAmount, providerHealth, remaining, resetPassed } from './display';
import { initialState, type Observation, type QuotaWindow } from '../shared/schema';

const window: QuotaWindow = { key: 'test', label: 'Test Window', kind: 'quota', scope: 'unknown', usedPercent: 32, used: null, limit: null, unit: 'percent', resetAt: '2026-11-01T09:30:00Z', durationMinutes: 300, cycleId: 'test', detail: null };
describe('quota display semantics', () => {
  it('keeps unknown and over-limit values distinct from zero usage', () => {
    expect(remaining(null)).toBeNull();
    expect(remaining(0)).toBe(100);
    expect(remaining(135)).toBe(0);
    expect(nativeAmount({ ...window, used: 12.5, limit: null, unit: 'USD', kind: 'spend' })).toBe('$12.50');
  });
  it('never manufactures a new cycle from an expired reset', () => {
    const now = Date.parse('2026-11-01T09:30:00Z');
    expect(resetPassed(window, now)).toBe(true);
    expect(countdown(window.resetAt, now)).toBe('Awaiting Confirmation');
    expect(countdown(null, now)).toBe('Reset Time Unknown');
    expect(countdown('2026-11-01T10:45:00Z', now)).toBe('1h 15m');
    expect(countdown('2026-11-01T09:30:01Z', now)).toBe('1m');
  });
  it('uses exact UTC instants across the repeated fall daylight-saving hour', () => {
    expect(dateTime('2026-11-01T08:30:00Z', 'America/Los_Angeles')).toContain('PDT');
    expect(dateTime('2026-11-01T09:30:00Z', 'America/Los_Angeles')).toContain('PST');
    expect(countdown(window.resetAt, Date.parse('2026-11-01T08:30:00Z'))).toBe('1h 0m');
  });
  it('locally ages a formerly fresh observation while preserving disconnect and errors', () => {
    const provider = initialState().providers[1];
    const observation: Observation = { id: 'one', provider: 'codex', observedAt: '2026-10-05T10:00:00Z', receivedAt: '2026-10-05T10:00:00Z', source: 'codex-app-server', windows: [{ ...window, resetAt: null }] };
    const connected = { ...provider, status: 'connected' as const, enabled: true, freshness: 'fresh' as const, observation };
    const now = Date.parse('2026-10-05T10:16:00Z');
    expect(providerHealth(connected, now, 15).label).toBe('Stale Reading');
    expect(providerHealth({ ...connected, status: 'disconnected' }, now, 15).label).toBe('Disconnected');
    expect(providerHealth({ ...connected, status: 'error' }, now, 15).label).toBe('Needs Attention');
  });
  it('deduplicates refreshed history without dropping previously loaded records', () => {
    const old: Observation = { id: 'old', provider: 'codex', observedAt: '2026-10-05T10:00:00Z', receivedAt: '2026-10-05T10:00:00Z', source: 'codex-app-server', windows: [] };
    const recent = { ...old, id: 'recent', observedAt: '2026-10-05T11:00:00Z' };
    expect(mergeObservations([old, recent], [recent]).map(item => item.id)).toEqual(['recent', 'old']);
  });
});
