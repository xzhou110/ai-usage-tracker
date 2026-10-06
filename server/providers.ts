import type { Connectors, ConnectorResult, Observation, ProviderId, ProviderOperation } from '../shared/schema.ts';
import { providerIds, providerDefinitions } from '../shared/schema.ts';
import { AppError } from './errors.ts';
import { StateStore, sameQuota, validateObservation } from './store.ts';
import { ConnectorError } from './connectors/errors.ts';
import { CURSOR_BROWSER_GUIDANCE } from './connectors/cursor.ts';

type Operation = 'connect' | 'refresh';

/** Each provider owns one active operation and its own polling/backoff clock. */
export class ProviderService {
  private store: StateStore;
  private connectors: Connectors;
  private inFlight = new Map<ProviderId, Promise<unknown>>();
  private reserved = new Set<ProviderId>();
  private next = new Map<ProviderId, number>();
  private lastRequested = new Map<ProviderId, number>();
  private failures = new Map<ProviderId, number>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private tickActive = false;
  private throttleMs: number;
  private fault: AppError | null = null;

  constructor(store: StateStore, connectors: Connectors, throttleMs = 10_000) {
    this.store = store;
    this.connectors = connectors;
    this.throttleMs = throttleMs;
  }

  async start(poll = true): Promise<void> {
    await this.store.transaction(state => {
      for (const provider of state.providers) {
        if (provider.enabled && provider.id === 'cursor') {
          provider.status = 'waiting';
          provider.verified = false;
          provider.message = CURSOR_BROWSER_GUIDANCE;
          provider.errorCode = null;
          provider.nextRefreshAt = null;
        } else if (provider.enabled && provider.status === 'connecting') {
          provider.status = 'waiting';
          provider.message = 'The previous connection was interrupted. Refresh or reconnect to continue.';
        }
      }
    });
    if (poll) {
      this.timer = setInterval(() => { void this.tick(); }, 1000);
      this.timer.unref();
    }
  }

  checkHealth(): void {
    if (this.fault) throw this.fault;
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.tickActive) return;
    this.tickActive = true;
    try {
      const snapshot = await this.store.snapshot();
      for (const provider of snapshot.providers) {
        if (!provider.enabled || provider.id === 'cursor' || this.reserved.has(provider.id)) continue;
        const due = this.next.get(provider.id) ?? (provider.nextRefreshAt ? Date.parse(provider.nextRefreshAt) : 0);
        if (due <= Date.now()) await this.request(provider.id, 'refresh', true);
      }
      this.fault = null;
    } catch (error) {
      this.fault = error instanceof AppError ? error : new AppError(500, 'STORAGE_ERROR', 'Local data could not be safely updated.');
    } finally { this.tickActive = false; }
  }

  async request(providerId: ProviderId, operation: Operation, automatic = false): Promise<ProviderOperation> {
    if (this.stopped) throw new AppError(503, 'UNAVAILABLE', 'The tracker is shutting down.');
    const rejectDuplicate = (message: string) => ({ provider: providerId, accepted: false, message });
    if (this.reserved.has(providerId)) return rejectDuplicate('An update is already in progress.');
    if (operation === 'refresh' && !automatic && Date.now() - (this.lastRequested.get(providerId) ?? 0) < this.throttleMs) return rejectDuplicate('An update was just requested. Wait a moment before refreshing again.');
    this.reserved.add(providerId);
    let skip = false;
    try {
      await this.store.transaction(state => {
        const provider = state.providers.find(item => item.id === providerId)!;
        if (operation === 'refresh' && !provider.enabled) throw new AppError(409, 'CONFLICT', 'Connect this provider before refreshing.');
        // An explicit experimental reconnect must reach the connector so an
        // unavailable integration can report its current limitation.
        if (operation === 'connect' && provider.enabled && (provider.status === 'connecting' || provider.status === 'connected' && providerId !== 'cursor')) { skip = true; return; }
        if (operation === 'connect') {
          provider.enabled = true;
          provider.status = 'connecting';
          provider.message = 'Connecting to the selected quota source.';
          provider.errorCode = null;
        }
        // Passive reads of unchanged inbox data must not generate five-second SSE writes.
        if (!automatic || providerId !== 'claude') provider.lastAttemptAt = new Date().toISOString();
      });
      if (skip) { this.reserved.delete(providerId); return rejectDuplicate('This provider is already connected.'); }
    } catch (error) {
      this.reserved.delete(providerId);
      throw error;
    }
    this.lastRequested.set(providerId, Date.now());
    const promise = this.perform(providerId, operation, automatic).catch(error => {
      // A failed persistence operation is visible through health/status, never silently swallowed.
      this.fault = error instanceof AppError ? error : new AppError(500, 'STORAGE_ERROR', 'A provider update could not be saved.');
    }).finally(() => {
      this.reserved.delete(providerId);
      this.inFlight.delete(providerId);
    });
    this.inFlight.set(providerId, promise);
    return { provider: providerId, accepted: true, message: operation === 'connect' ? 'Connection started.' : 'Refresh started.' };
  }

  private async perform(providerId: ProviderId, operation: Operation, automatic: boolean): Promise<void> {
    let result: ConnectorResult;
    try {
      result = await this.connectors[providerId][operation]();
      if (result.observation) validateObservation(result.observation, providerId);
      if (typeof result.message !== 'string' || result.message.length > 1000) throw new Error('Invalid connector message.');
    } catch (error) {
      const attempts = (this.failures.get(providerId) ?? 0) + 1;
      this.failures.set(providerId, attempts);
      const delay = Math.min(providerId === 'claude' ? 300_000 : 3_600_000, (providerId === 'claude' ? 5000 : 300_000) * 2 ** Math.min(attempts - 1, 10));
      this.next.set(providerId, Date.now() + delay);
      await this.store.transaction(state => {
        const provider = state.providers.find(item => item.id === providerId)!;
        provider.status = 'error';
        provider.message = error instanceof ConnectorError ? error.message : 'The quota source could not be updated. Check the provider or reconnect; the last successful observation is preserved.';
        provider.errorCode = error instanceof ConnectorError ? error.code : 'SOURCE_UNAVAILABLE';
        provider.nextRefreshAt = providerId === 'codex' ? new Date(this.next.get(providerId)!).toISOString() : null;
      });
      return;
    }
    this.failures.delete(providerId);
    this.next.set(providerId, Date.now() + (providerId === 'claude' ? 5000 : 300_000));
    await this.store.transaction(async state => {
      const provider = state.providers.find(item => item.id === providerId)!;
      const quotaChanged = !!result.observation && !sameQuota(provider.observation, result.observation);
      if (result.observation) {
        // Codex polls provide new evidence even for unchanged usage; a passive bridge does not.
        if (providerId !== 'claude' || quotaChanged || !provider.observation) provider.observation = await this.store.saveObservation(state, result.observation);
        if (providerId !== 'claude' || quotaChanged || !automatic) provider.lastSuccessAt = result.observation.observedAt;
      }
      provider.status = result.waiting || !result.observation && !provider.observation ? 'waiting' : 'connected';
      provider.message = result.message;
      provider.errorCode = null;
      if (result.verified !== undefined) provider.verified = result.verified;
      provider.nextRefreshAt = providerId === 'codex' ? new Date(this.next.get(providerId)!).toISOString() : null;
    });
    this.fault = null;
  }

  async refreshAll(): Promise<ProviderOperation[]> {
    const snapshot = await this.store.snapshot();
    return Promise.all(snapshot.providers.map(provider => provider.id === 'cursor'
      ? Promise.resolve({ provider: provider.id, accepted: false, message: CURSOR_BROWSER_GUIDANCE })
      : provider.enabled ? this.request(provider.id, 'refresh') : Promise.resolve({ provider: provider.id, accepted: false, message: 'Connect this provider before refreshing.' })));
  }

  async receiveCursor(observation: Observation): Promise<void> {
    if (this.stopped) throw new AppError(503, 'UNAVAILABLE', 'The tracker is shutting down.');
    if (this.reserved.has('cursor')) throw new AppError(409, 'CONFLICT', 'A Cursor update is in progress. Sync again in a moment.');
    validateObservation(observation, 'cursor');
    this.reserved.add('cursor');
    try {
      await this.store.transaction(async state => {
        const provider = state.providers.find(item => item.id === 'cursor')!;
        provider.observation = await this.store.saveObservation(state, observation);
        provider.enabled = true; provider.status = 'connected'; provider.verified = false;
        provider.message = 'Quota received from your paired browser extension. Experimental: compare these readings with Cursor Spending.';
        provider.errorCode = null; provider.lastAttemptAt = observation.receivedAt; provider.lastSuccessAt = observation.observedAt; provider.nextRefreshAt = null;
      });
    } finally { this.reserved.delete('cursor'); }
  }

  async disconnect(providerId: ProviderId) {
    if (this.reserved.has(providerId)) throw new AppError(409, 'CONFLICT', 'Wait for the current update to finish before disconnecting.');
    this.reserved.add(providerId);
    try {
      try { await this.connectors[providerId].disconnect(); }
      catch (error) { throw new AppError(409, 'CONFLICT', error instanceof ConnectorError ? error.message : 'The connection could not be cleanly removed. Its configuration may have changed; check the provider before retrying.'); }
      this.next.delete(providerId);
      this.failures.delete(providerId);
      return await this.store.transaction(state => {
        const provider = state.providers.find(item => item.id === providerId)!;
        provider.enabled = false;
        provider.status = 'disconnected';
        provider.message = providerDefinitions[providerId].message;
        provider.errorCode = null;
        provider.nextRefreshAt = null;
      });
    } finally { this.reserved.delete(providerId); }
  }

  async close(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    // Closing connectors first cancels native work where supported; then drain all state updates.
    const closed = await Promise.allSettled(providerIds.map(id => this.connectors[id].close()));
    await Promise.all(this.inFlight.values());
    if (closed.some(result => result.status === 'rejected')) throw new AppError(503, 'UNAVAILABLE', 'A quota connection could not be cleanly closed.');
  }
}
