import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { errorCode, storageError } from './errors.ts';

/** Commit only complete bytes. A failed write never removes the previous file. */
export async function writeAtomic(file: string, bytes: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(bytes, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporary, file);
        break;
      } catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(errorCode(error) ?? '') || attempt >= 5) throw error;
        await delay(25 * (attempt + 1));
      }
    }
  } catch {
    // A stale temporary file is harmless; failure to remove one must not mask the write failure.
    await unlink(temporary).catch(() => {});
    throw storageError();
  }
}
