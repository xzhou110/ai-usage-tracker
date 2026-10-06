/* Runs in the isolated extension world. Never reads DOM, cookies, or login fields. */
async function readCursorQuota() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const endpoint = 'https://cursor.com/api/usage-summary';
    const response = await fetch(endpoint, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
    if (!response.ok || response.url !== endpoint || !response.headers.get('content-type')?.includes('application/json')) throw new Error();
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks = []; let bytes = 0;
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      // Transport protection, not a limit on the user's usage or stored history.
      if (bytes > 1000000) { await reader.cancel(); throw new Error(); }
      chunks.push(chunk.value);
    }
    const buffer = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder().decode(buffer));
    const object = value => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; };
    const source = object(data); const payload = {};
    for (const field of ['billingCycleStart', 'billingCycleEnd']) {
      if (!Object.hasOwn(source, field)) continue;
      const value = source[field];
      if (value != null && (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error();
      payload[field] = value ?? null;
    }
    for (const [group, pools] of [['individualUsage', ['plan', 'overall', 'onDemand']], ['teamUsage', ['pooled', 'onDemand']]]) {
      if (source[group] == null) continue;
      const sourceGroup = object(source[group]); const groupResult = {};
      for (const pool of pools) {
        if (sourceGroup[pool] == null) continue;
        const sourcePool = object(sourceGroup[pool]); const poolResult = {};
        for (const field of ['used', 'limit', 'totalPercentUsed', 'autoPercentUsed', 'apiPercentUsed']) {
          if (!Object.hasOwn(sourcePool, field)) continue;
          const value = sourcePool[field];
          if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error();
          poolResult[field] = value ?? null;
        }
        groupResult[pool] = poolResult;
      }
      payload[group] = groupResult;
    }
    return { observedAt: new Date().toISOString(), payload };
  } finally { clearTimeout(timer); }
}
