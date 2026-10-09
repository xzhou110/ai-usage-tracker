import { createHash, randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { mkdir, readFile, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { initialState, StateSchema, ObservationSchema, providerIds } from '../shared/schema.ts';
import type { StoredState, Observation, DashboardSnapshot, HistoryPage, ProviderId } from '../shared/schema.ts';
import { writeAtomic } from './atomic.ts';
import { AppError, errorCode, storageError } from './errors.ts';
import { reconcileActions } from './actions.ts';

const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const serialize = (state: StoredState) => `${JSON.stringify(state, null, 2)}\n`;
type Reader = { state: StoredState; bytes: string; revision: string };

export function validateState(value: unknown): StoredState {
  const state = StateSchema.parse(value);
  if (state.providers.length !== 3 || state.providers.some((provider, index) => provider.id !== providerIds[index])) throw storageError();
  if (new Set(state.actions.map(action => action.id)).size !== state.actions.length) throw storageError();
  for (const provider of state.providers) {
    if (provider.observation) validateObservation(provider.observation, provider.id);
  }
  return state;
}

export function validateObservation(value: unknown, provider: ProviderId): Observation {
  const observation = ObservationSchema.parse(value);
  const sources = { claude: 'claude-statusline', codex: 'codex-app-server', cursor: 'cursor-browser' };
  const correctSource = observation.source === sources[provider] || provider === 'claude' && observation.source === 'claude-desktop-mod';
  if (observation.provider !== provider || !correctSource || new Set(observation.windows.map(window => window.key)).size !== observation.windows.length) throw storageError();
  return observation;
}

export function sameQuota(left: Observation | null, right: Observation): boolean {
  return !!left && left.source === right.source && JSON.stringify(left.windows) === JSON.stringify(right.windows);
}

export class StateStore {
  root: string;
  statePath: string;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(revision: string) => void>();
  private revision: string | null = null;
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;
  private closed = false;
  private fault: AppError | null = null;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.statePath = path.join(this.root, 'local', 'state.json');
  }

  async initialize(enableWatch = true): Promise<void> {
    try {
      await mkdir(path.join(this.root, 'local', 'history'), { recursive: true });
      try {
        await this.read();
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
        const state = initialState();
        reconcileActions(state);
        // wx prevents another process from silently replacing an existing state.
        const handle = await open(this.statePath, 'wx', 0o600);
        try { await handle.writeFile(serialize(state), 'utf8'); await handle.sync(); } finally { await handle.close(); }
      }
      this.revision = (await this.read()).revision;
    } catch { throw storageError(); }
    if (enableWatch) {
      this.watcher = watch(path.dirname(this.statePath), (_event, file) => {
        if (file !== null && String(file) !== 'state.json') return;
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => { void this.reconcile().catch(() => this.reportFault()); }, 150);
      });
      this.watcher.on('error', () => this.reportFault());
      this.timer = setInterval(() => { void this.reconcile().catch(() => this.reportFault()); }, 15_000);
      this.timer.unref();
    }
  }

  private reportFault(): void {
    this.fault = storageError();
    // Wake clients so their next read reports a safe storage error rather than stale success.
    this.emit('unavailable');
  }

  private async read(): Promise<Reader> {
    const bytes = await readFile(this.statePath, 'utf8');
    try { return { state: validateState(JSON.parse(bytes)), bytes, revision: hash(bytes) }; }
    catch { throw storageError(); }
  }

  private serializeTask<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (this.closed) throw storageError();
      return operation();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  private emit(revision: string): void {
    if (this.revision === revision) return;
    this.revision = revision;
    for (const listener of this.listeners) listener(revision);
  }

  subscribe(listener: (revision: string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async transaction(change: (state: StoredState) => void | Promise<void>, expected?: string): Promise<DashboardSnapshot> {
    return this.serializeTask(async () => {
      try {
        const current = await this.read();
        if (expected !== undefined && expected !== `"${current.revision}"`) throw new AppError(412, 'PRECONDITION_FAILED', 'Data changed since you opened it. Reload before applying your changes.');
        const state = structuredClone(current.state);
        await change(state);
        const now = new Date();
        reconcileActions(state, now);
        validateState(state);
        const bytes = serialize(state);
        let revision = current.revision;
        if (JSON.stringify(state) !== JSON.stringify(current.state)) {
          // Detect edits that arrived while an asynchronous transaction was in progress.
          if ((await this.read()).revision !== current.revision) throw new AppError(412, 'PRECONDITION_FAILED', 'Data changed on disk. Reload before trying again.');
          await writeAtomic(this.statePath, bytes);
          revision = hash(bytes);
        }
        this.fault = null;
        this.emit(revision);
        return { revision, serverTime: now.toISOString(), settings: state.settings, providers: state.providers, actions: state.actions };
      } catch (error) {
        if (error instanceof AppError && error.code !== 'STORAGE_ERROR') throw error;
        this.reportFault();
        throw storageError();
      }
    });
  }

  snapshot(): Promise<DashboardSnapshot> { return this.transaction(() => {}); }
  reconcile(): Promise<DashboardSnapshot> { return this.snapshot(); }

  /** History is written first, so a state failure can leave only a harmless orphan. */
  async saveObservation(state: StoredState, observation: Observation): Promise<Observation> {
    const validated = validateObservation(observation, observation.provider);
    const provider = state.providers.find(item => item.id === observation.provider)!;
    if (!sameQuota(provider.observation, validated)) {
      const normalized = { ...validated, id: randomUUID() };
      const directory = path.join(this.root, 'local', 'history', validated.provider);
      await mkdir(directory, { recursive: true });
      await writeAtomic(path.join(directory, `${normalized.id}.json`), `${JSON.stringify(normalized, null, 2)}\n`);
      return normalized;
    }
    return { ...validated, id: provider.observation!.id };
  }

  async history(provider?: ProviderId, cursor?: string): Promise<HistoryPage> {
    return this.serializeTask(async () => {
      try {
        const observations: Observation[] = [];
        for (const id of provider ? [provider] : providerIds) {
          const directory = path.join(this.root, 'local', 'history', id);
          let files: string[];
          try { files = await readdir(directory); } catch (error) { if (errorCode(error) === 'ENOENT') continue; throw error; }
          for (const file of files) {
            if (!/^[a-zA-Z0-9_-]+\.json$/.test(file)) continue;
            observations.push(validateObservation(JSON.parse(await readFile(path.join(directory, file), 'utf8')), id));
          }
        }
        observations.sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.id.localeCompare(a.id));
        let start = 0;
        if (cursor) {
          let parsed: unknown;
          try {
            if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
            parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
          } catch { throw new AppError(400, 'BAD_REQUEST', 'The history cursor is invalid.'); }
          if (!parsed || typeof parsed !== 'object' || !('id' in parsed) || !('provider' in parsed) || !('time' in parsed) || parsed.provider !== (provider ?? null) || typeof parsed.id !== 'string' || typeof parsed.time !== 'string') throw new AppError(400, 'BAD_REQUEST', 'The history cursor is invalid.');
          const position = observations.findIndex(item => item.id === parsed.id && item.observedAt === parsed.time);
          if (position < 0) throw new AppError(400, 'BAD_REQUEST', 'The history cursor is no longer available.');
          start = position + 1;
        }
        const page = observations.slice(start, start + 100);
        const last = page.at(-1);
        const nextCursor = start + page.length < observations.length && last ? Buffer.from(JSON.stringify({ id: last.id, time: last.observedAt, provider: provider ?? null })).toString('base64url') : null;
        return { observations: page, nextCursor };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw storageError();
      }
    });
  }

  async close(): Promise<void> {
    this.watcher?.close();
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    await this.queue;
    this.closed = true;
    this.listeners.clear();
  }
}
