const URL = 'http://127.0.0.1:8175/api/claude-desktop/reading';
const kinds = new Set(['five_hour', 'seven_day', 'spend_limit']);

// Project before crossing the local HTTP boundary. Never send session/context data.
export function projectLimits(limits) {
  if (!Array.isArray(limits)) return [];
  return limits.filter(limit => kinds.has(limit?.kind)).map(limit => {
    if (typeof limit.percentUsed !== 'number' || !Number.isFinite(limit.percentUsed) || limit.percentUsed < 0) throw new Error('Unsupported quota.');
    if (limit.resetsAt !== undefined && (typeof limit.resetsAt !== 'string' || !Number.isFinite(Date.parse(limit.resetsAt)))) throw new Error('Unsupported reset.');
    return { kind: limit.kind, percentUsed: limit.percentUsed, ...(limit.resetsAt === undefined ? {} : { resetsAt: new Date(limit.resetsAt).toISOString() }) };
  }).sort((a, b) => a.kind.localeCompare(b.kind));
}

let busy = false;
let lastProjection = '';
let captured = null;
async function send($) {
  if (busy || !captured) return;
  busy = true;
  try {
    await $.http.fetch(URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AI-Usage-Tracker': '1' },
      body: JSON.stringify({ ...captured, sentAt: new Date().toISOString() }),
    });
  } catch { /* A stopped tracker must not disrupt Claude or expose provider errors. */ }
  finally { busy = false; }
}
function queue($) {
  // Do not await network I/O in Claude's event chain. Keep at most one request
  // outstanding even if the host accepts a connection but never answers it.
  $.clock.after(0, () => { void send($); });
}
export function register(on) {
  let timer;
  on('session.start', async ($, e, next) => {
    timer?.cancel();
    // Retry the actual captured event; never timestamp a cached startup snapshot.
    timer = $.clock.every(60_000, () => { void send($); });
    return next(e);
  });
  on('session.measure', async ($, e, next) => {
    try {
      if (e.changed.includes('rateLimits')) {
        const rateLimits = projectLimits(e.rateLimits);
        const projection = JSON.stringify(rateLimits);
        if (rateLimits.length && projection !== lastProjection) {
          lastProjection = projection;
          captured = { rateLimits, observedAt: new Date().toISOString() };
        }
        queue($);
      }
    } catch { /* An unsupported measurement cannot affect the session. */ }
    return next(e);
  });
  on('session.end', async ($, e, next) => {
    captured = null; lastProjection = '';
    // Claude does not fire session.start again for /clear or /resume.
    if (e.reason !== 'clear' && e.reason !== 'resume') timer?.cancel();
    return next(e);
  });
}
