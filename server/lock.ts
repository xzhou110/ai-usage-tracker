import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { AppError, errorCode } from './errors.ts';

type Release = () => Promise<void>;

async function createExclusive(file: string, bytes: string): Promise<Release | null> {
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if (errorCode(error) === 'EEXIST') return null;
    throw new AppError(500, 'STORAGE_ERROR', 'The local server lock could not be created.');
  }
  try { await handle.writeFile(bytes, 'utf8'); await handle.sync(); }
  catch {
    await handle.close();
    // This incomplete file still belongs to us; malformed locks are never reclaimed elsewhere.
    await unlink(file).catch(() => {});
    throw new AppError(500, 'STORAGE_ERROR', 'The local server lock could not be saved.');
  }
  await handle.close();
  let released: Promise<void> | undefined;
  return () => released ??= (async () => {
    try {
      if (await readFile(file, 'utf8') === bytes) await unlink(file);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw new AppError(500, 'STORAGE_ERROR', 'The local server lock could not be removed.');
    }
  })();
}

function readPid(bytes: string): number {
  try {
    const value: unknown = JSON.parse(bytes);
    if (!value || typeof value !== 'object' || !('pid' in value) || !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 || Number(value.pid) > 2_147_483_647) throw new Error();
    return Number(value.pid);
  } catch { throw new AppError(409, 'CONFLICT', 'An unreadable server lock exists. Check whether the tracker is running before removing the lock.'); }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    // Permission failures and other uncertain results are treated as live ownership.
    return errorCode(error) !== 'ESRCH';
  }
}

/** Never kill processes. All stale deletion is serialized by a separate exclusive guard. */
export async function acquireLock(root: string, port: number): Promise<Release> {
  const directory = path.join(root, 'local');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'server.lock');
  const bytes = JSON.stringify({ pid: process.pid, port, token: randomUUID() });
  const acquired = await createExclusive(file, bytes);
  if (acquired) return acquired;

  const recoveryFile = path.join(directory, 'server-recovery.lock');
  const releaseRecovery = await createExclusive(recoveryFile, bytes);
  if (!releaseRecovery) {
    // A crashed recovery is deliberately fail-closed. Automatically deleting this guard
    // would recreate the same stale-delete race one level higher.
    let active = true;
    try { active = isAlive(readPid(await readFile(recoveryFile, 'utf8'))); } catch { /* The current writer may not have finished yet. */ }
    throw new AppError(409, 'CONFLICT', active
      ? 'Another tracker launch is checking the server lock. Wait a moment before trying again.'
      : 'A previous lock recovery was interrupted. After confirming the tracker is stopped, remove local/server-recovery.lock and try again.');
  }

  try {
    let previous: string | undefined;
    try { previous = await readFile(file, 'utf8'); }
    catch (error) { if (errorCode(error) !== 'ENOENT') throw new AppError(500, 'STORAGE_ERROR', 'The local server lock could not be checked.'); }
    if (previous !== undefined) {
      if (isAlive(readPid(previous))) throw new AppError(409, 'CONFLICT', 'A process still owns this tracker data folder.');
      // Every contender that could delete a stale file holds this guard. Nobody can act
      // on a stale read after a successor has claimed the main lock.
      try { await unlink(file); }
      catch (error) { if (errorCode(error) !== 'ENOENT') throw new AppError(500, 'STORAGE_ERROR', 'The stale server lock could not be removed.'); }
    }
    const recovered = await createExclusive(file, bytes);
    if (!recovered) throw new AppError(409, 'CONFLICT', 'Another tracker server acquired the data folder.');
    return recovered;
  } finally { await releaseRecovery(); }
}
