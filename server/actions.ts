import { createHash } from 'node:crypto';
import type { StoredState, UsageAction, ProviderId } from '../shared/schema.ts';

type Condition = Pick<UsageAction, 'provider' | 'windowKey' | 'kind' | 'title' | 'description' | 'severity'> & { identity: string };

function identity(provider: ProviderId, kind: string, windowKey = '', cycleId = ''): string {
  return createHash('sha256').update(JSON.stringify([provider, kind, windowKey, cycleId])).digest('hex');
}

/** Freshness and elapsed reset times are evidence labels, never new quota observations. */
export function reconcileActions(state: StoredState, now = new Date()): void {
  const timestamp = now.toISOString();
  const conditions: Condition[] = [];
  for (const provider of state.providers) {
    const observation = provider.observation;
    provider.freshness = !observation ? 'unknown' : now.getTime() - Date.parse(observation.observedAt) >= state.settings.staleAfterMinutes * 60_000 ? 'stale' : 'fresh';
    const add = (kind: UsageAction['kind'], title: string, description: string, severity: UsageAction['severity'] = 'info', windowKey: string | null = null, cycleId = '') => {
      conditions.push({ identity: identity(provider.id, kind, windowKey ?? '', cycleId), provider: provider.id, windowKey, kind, title, description, severity });
    };
    const cursorBrowser = provider.id === 'cursor';
    if (!provider.enabled) {
      add('disconnected', `Connect ${provider.name}`, cursorBrowser ? 'Pair the browser extension in Connection Details, then use Sync Now on the signed-in Cursor dashboard.' : `Connect ${provider.name} to collect quota updates. Previous observations remain in History.`);
      continue;
    }
    if (provider.status === 'waiting') add('waiting', `${provider.name} Is Waiting`, provider.message);
    if (provider.status === 'error') add('error', `${provider.name} Needs Attention`, provider.message, 'warning');
    if (provider.freshness === 'stale') add('stale', `${provider.name} Data Is Stale`, cursorBrowser ? 'Keep Cursor’s dashboard tab open and use Sync Now in the extension. Check official usage before relying on this saved reading.' : 'This observation is older than your freshness setting. Refresh or check the source before relying on it.', 'warning');
    for (const window of observation?.windows ?? []) {
      if (window.kind !== 'quota') continue;
      const cycle = window.cycleId ?? window.resetAt ?? 'unknown';
      if (window.resetAt && Date.parse(window.resetAt) <= now.getTime()) {
        add('awaiting-confirmation', `${provider.name} Reset Needs Confirmation`, `${window.label} reached its recorded reset time. ${cursorBrowser ? 'Use Sync Now in the browser extension, or check the official Cursor dashboard.' : 'Refresh to confirm the new allowance.'}`, 'warning', window.key, cycle);
        continue;
      }
      if (window.usedPercent !== null && window.usedPercent >= 100) {
        add('exhausted', `${provider.name} Quota Is Exhausted`, `${window.label} reports ${window.usedPercent}% used. Check its reset time or another provider.`, 'critical', window.key, cycle);
      } else if (window.usedPercent !== null && window.usedPercent >= state.settings.warningPercent) {
        add('near-limit', `${provider.name} Is Near Its Limit`, `${window.label} is at or above your ${state.settings.warningPercent}% warning threshold.`, 'warning', window.key, cycle);
      }
    }
  }

  const active = new Set<string>();
  for (const condition of conditions) {
    // Recurrent conditions get a new episode, so a dismissal never suppresses a future occurrence.
    const prefix = `${condition.identity}_`;
    const episodes = state.actions.filter(action => action.id.startsWith(prefix));
    const previous = episodes.find(action => action.state !== 'resolved');
    const { identity: unused, ...fields } = condition;
    if (previous) {
      active.add(previous.id);
      const changed = previous.title !== fields.title || previous.description !== fields.description || previous.severity !== fields.severity;
      Object.assign(previous, fields);
      if (changed) previous.updatedAt = timestamp;
    } else {
      const id = `${prefix}${episodes.length + 1}`;
      active.add(id);
      state.actions.push({ id, ...fields, state: 'open', firstSeenAt: timestamp, updatedAt: timestamp, dismissedAt: null, resolvedAt: null });
    }
  }
  for (const action of state.actions) {
    if (action.state !== 'resolved' && !active.has(action.id)) {
      action.state = 'resolved';
      action.resolvedAt = timestamp;
      action.updatedAt = timestamp;
    }
  }
}
