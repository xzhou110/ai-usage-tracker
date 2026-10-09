import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ObservationSchema, type Observation } from '../../shared/schema.ts';
import { AppError } from '../errors.ts';

export const CLAUDE_DESKTOP_GUIDANCE = 'Claude Desktop Code sends quota while a local Code session is open. Open a new Code session after installing the bridge, then continue normal work. Refresh checks the saved reading; no paid test message is needed.';
const definitions = {
  five_hour: { label: 'Five-Hour Limit', durationMinutes: 300 },
  seven_day: { label: 'Seven-Day Limit', durationMinutes: 10080 },
  spend_limit: { label: 'Gateway Spend Limit', durationMinutes: null },
} as const;
export const desktopReadingSchema = z.object({
  observedAt: z.string().datetime(),
  sentAt: z.string().datetime(),
  rateLimits: z.array(z.object({
    kind: z.enum(['five_hour', 'seven_day', 'spend_limit']),
    percentUsed: z.number().finite().nonnegative(),
    resetsAt: z.string().datetime().optional(),
  }).strict()).min(1).max(3),
}).strict();

export function parseClaudeDesktop(input: unknown, now = Date.now()): Observation {
  const parsed = desktopReadingSchema.safeParse(input);
  if (!parsed.success || Math.abs(now - Date.parse(parsed.data.sentAt)) > 60_000 ||
      Date.parse(parsed.data.observedAt) > Date.parse(parsed.data.sentAt) ||
      new Set(parsed.data.rateLimits.map(limit => limit.kind)).size !== parsed.data.rateLimits.length) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Claude sent an unsupported or delayed quota reading. The previous reading is preserved.');
  }
  return ObservationSchema.parse({
    id: randomUUID(), provider: 'claude', source: 'claude-desktop-mod',
    observedAt: parsed.data.observedAt, receivedAt: new Date(now).toISOString(),
    windows: [...parsed.data.rateLimits].sort((a, b) => a.kind.localeCompare(b.kind)).map(limit => ({
      key: limit.kind, ...definitions[limit.kind], kind: 'quota', scope: 'personal',
      usedPercent: limit.percentUsed, used: null, limit: null, unit: 'percent',
      resetAt: limit.resetsAt ?? null, cycleId: limit.resetsAt ?? null,
      detail: 'Reported by Claude Code through its native mods API. Repeated cached values do not advance freshness.',
    })),
  });
}
