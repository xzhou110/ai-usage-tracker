import { randomUUID } from 'node:crypto';
import { IsoTimeSchema, type Observation, type ProviderId, type QuotaWindow } from '../../shared/schema.ts';
import { ConnectorError } from './errors.ts';

export const invalidPayload = () => new ConnectorError('UNSUPPORTED_QUOTA_FORMAT', 'The provider returned an unsupported quota format. Your previous observation is preserved.');
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidPayload();
  return value as Record<string, unknown>;
}
export function number(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw invalidPayload();
  return value;
}
export function epoch(value: unknown): string | null {
  const seconds = number(value);
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) throw invalidPayload();
  return date.toISOString();
}
export function instant(value: unknown): string | null {
  if (value == null) return null;
  if (!IsoTimeSchema.safeParse(value).success || typeof value !== 'string') throw invalidPayload();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) throw invalidPayload();
  return date.toISOString();
}
export function observation(provider: ProviderId, source: Observation['source'], windows: QuotaWindow[], now = new Date().toISOString()): Observation {
  return { id: randomUUID(), provider, source, windows, observedAt: now, receivedAt: now };
}
