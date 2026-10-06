// Read-only live probe. Prints only validation flags/counts, never account quota values.
import { CodexConnector } from '../server/connectors/codex.ts';
import { ObservationSchema } from '../shared/schema.ts';

const connector = new CodexConnector();
try {
  const result = await connector.connect();
  const valid = ObservationSchema.safeParse(result.observation).success;
  const windows = result.observation?.windows ?? [];
  console.log(JSON.stringify({ ok: valid, windowCount: windows.length,
    percentagesValid: windows.every(window => window.usedPercent === null || Number.isFinite(window.usedPercent)),
    resetTimesValid: windows.every(window => window.resetAt === null || Number.isFinite(Date.parse(window.resetAt))) }));
  if (!valid) process.exitCode = 1;
} catch {
  console.log(JSON.stringify({ ok: false, reason: 'quota_unavailable' }));
  process.exitCode = 1;
} finally { await connector.close(); }
