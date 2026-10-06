import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ObservationSchema, type Observation } from '../../shared/schema.ts';
import { writeAtomic } from '../atomic.ts';
import { AppError } from '../errors.ts';

export const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const savedSchema = z.object({
  origin: z.string().regex(extensionOrigin).nullable(), tokenHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  observation: ObservationSchema.nullable(),
}).strict();
const numeric = z.number().finite().nonnegative().nullable().optional();
const pool = z.object({ used: numeric, limit: numeric, totalPercentUsed: numeric, autoPercentUsed: numeric, apiPercentUsed: numeric }).strict();
const date = z.string().datetime({ offset: true }).nullable().optional();
export const browserReadingSchema = z.object({ observedAt: z.string().datetime(), payload: z.object({
  billingCycleStart: date, billingCycleEnd: date,
  individualUsage: z.object({ plan: pool.optional(), overall: pool.optional(), onDemand: pool.optional() }).strict().optional(),
  teamUsage: z.object({ pooled: pool.optional(), onDemand: pool.optional() }).strict().optional(),
}).strict() }).strict();

/** Pairing and reads share a queue with revocation; browser credentials never enter this class. */
export class CursorBrowserBridge {
  private file: string;
  private directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  private pairing: { hash: string; expires: number } | null = null;
  constructor(root: string) { this.directory = join(root, 'local'); this.file = join(this.directory, 'cursor-browser-connection.json'); }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next;
  }
  private async read() {
    try { return savedSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { origin: null, tokenHash: null, observation: null };
      throw new AppError(500, 'STORAGE_ERROR', 'The local Cursor connection could not be read safely.');
    }
  }
  private async save(value: z.infer<typeof savedSchema>) {
    await mkdir(this.directory, { recursive: true });
    await writeAtomic(this.file, JSON.stringify(savedSchema.parse(value)));
  }
  issuePairing() { return this.serial(async () => {
    const code = randomBytes(16).toString('hex');
    this.pairing = { hash: hash(code), expires: Date.now() + 10 * 60_000 };
    return { code, expiresAt: new Date(this.pairing.expires).toISOString() };
  }); }
  pair(origin: string, code: string) { return this.serial(async () => {
    if (!extensionOrigin.test(origin) || !/^[a-f0-9]{32}$/.test(code) || !this.pairing || Date.now() >= this.pairing.expires || !equal(hash(code), this.pairing.hash)) throw new AppError(403, 'FORBIDDEN', 'Pairing code is invalid or expired. Generate a new code in the tracker.');
    const token = randomBytes(32).toString('hex');
    await this.save({ origin, tokenHash: hash(token), observation: null });
    this.pairing = null;
    return { token };
  }); }
  accept(origin: string, token: string, input: unknown, normalize: (payload: unknown, at: string) => Observation, receive: (reading: Observation) => Promise<void>) {
    return this.serial(async () => {
      const saved = await this.read();
      if (!extensionOrigin.test(origin) || origin !== saved.origin || !saved.tokenHash || !/^[a-f0-9]{64}$/.test(token) || !equal(hash(token), saved.tokenHash)) throw new AppError(403, 'FORBIDDEN', 'Pair this extension with the tracker first.');
      const result = browserReadingSchema.safeParse(input);
      if (!result.success || Math.abs(Date.now() - Date.parse(result.data.observedAt)) > 60_000) throw new AppError(422, 'VALIDATION_ERROR', 'Cursor sent an invalid or delayed quota reading. Sync again from its dashboard.');
      let observation: Observation;
      try { observation = normalize(result.data.payload, result.data.observedAt); }
      catch { throw new AppError(422, 'VALIDATION_ERROR', 'Cursor quota format is not supported. Previous readings are preserved.'); }
      await receive(observation);
      await this.save({ ...saved, observation });
    });
  }
  current() { return this.serial(() => this.read()); }
  disconnect() { return this.serial(async () => {
    await this.save({ origin: null, tokenHash: null, observation: null }); this.pairing = null;
  }); }
}
