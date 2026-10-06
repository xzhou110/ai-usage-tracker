import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WINDOW_FIELDS = [
  ['five_hour', 'Five-Hour Limit', 300],
  ['seven_day', 'Seven-Day Limit', 10080],
];
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const numeric = value => value == null ? null : typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));

export function projectClaudeInput(input) {
  if (!isObject(input) || !isObject(input.rate_limits)) return null;
  const windows = [];
  for (const [key, label, durationMinutes] of WINDOW_FIELDS) {
    const source = input.rate_limits[key];
    if (source == null) continue;
    if (!isObject(source)) throw new Error('Unsupported Claude quota format.');
    const usedPercent = numeric(source.used_percentage);
    const seconds = numeric(source.resets_at);
    if (usedPercent === undefined || seconds === undefined) throw new Error('Unsupported Claude quota format.');
    let resetAt = null;
    if (seconds !== null) {
      const date = new Date(seconds * 1000);
      if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) throw new Error('Unsupported Claude quota date.');
      resetAt = date.toISOString();
    }
    windows.push({ key, label, kind: 'quota', scope: 'personal', usedPercent, used: null, limit: null, unit: 'percent', resetAt,
      durationMinutes, cycleId: resetAt, detail: 'Reported by Claude Code during normal use; idle refreshes may repeat cached data.' });
  }
  return windows;
}

export async function readSmallJson(path, maxBytes = 2_000_000) {
  const handle = await open(path, 'r');
  try {
    if ((await handle.stat()).size > maxBytes) throw new Error('Local integration file exceeds the size limit.');
    const text = await handle.readFile('utf8');
    if (Buffer.byteLength(text) > maxBytes) throw new Error('Local integration file exceeds the size limit.');
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } finally { await handle.close(); }
}

export async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, path); break; }
      catch (error) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 4) throw error;
        await pause(25 * (attempt + 1));
      }
    }
  } finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
}

export async function writeClaudeProjection(root, input, now = new Date().toISOString()) {
  const windows = projectClaudeInput(input);
  if (windows === null) return { changed: false, written: false };
  const local = join(root, 'local');
  await mkdir(local, { recursive: true });
  const lockPath = join(local, 'claude-inbox.lock');
  let lock;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { lock = await open(lockPath, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const lockStat = await stat(lockPath).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > 30_000) await unlink(lockPath).catch(() => {});
      await pause(15);
    }
  }
  if (!lock) throw new Error('Claude quota storage is busy.');
  try {
    const inboxPath = join(local, 'claude-inbox.json');
    let previous = null;
    try { previous = await readSmallJson(inboxPath); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Claude quota storage could not be read safely.'); }
    if (previous !== null && (!isObject(previous) || previous.provider !== 'claude' || previous.source !== 'claude-statusline' ||
        typeof previous.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(previous.id) || !Array.isArray(previous.windows) ||
        typeof previous.observedAt !== 'string' || !Number.isFinite(Date.parse(previous.observedAt)) ||
        typeof previous.receivedAt !== 'string' || !Number.isFinite(Date.parse(previous.receivedAt)) ||
        Object.keys(previous).some(key => !['id', 'provider', 'source', 'observedAt', 'receivedAt', 'windows'].includes(key)))) {
      throw new Error('Claude quota storage could not be read safely.');
    }
    const digest = createHash('sha256').update(JSON.stringify(windows)).digest('hex');
    // Hash only the sanitized quota, never the raw status-line input.
    const previousDigest = isObject(previous) && Array.isArray(previous.windows)
      ? createHash('sha256').update(JSON.stringify(previous.windows)).digest('hex') : null;
    const changed = digest !== previousDigest;
    const observation = { id: changed ? randomUUID() : previous.id, provider: 'claude', source: 'claude-statusline',
      observedAt: changed ? now : previous.observedAt, receivedAt: now, windows };
    await atomicJson(inboxPath, observation);
    return { changed, written: true };
  } finally { await lock.close(); await unlink(lockPath).catch(() => {}); }
}

export async function resolveNativeShell() {
  if (process.platform !== 'win32') return { kind: 'posix', path: process.env.SHELL || '/bin/sh' };
  const candidates = [process.env.CLAUDE_CODE_GIT_BASH_PATH,
    join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe')].filter(Boolean);
  for (const path of candidates) { try { await access(path); return { kind: 'posix', path }; } catch { /* Try the next supported native shell. */ } }
  return { kind: 'powershell', path: join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') };
}

export function quoteNativeArgument(value, shellKind) {
  const path = value.replaceAll('\\', '/');
  return shellKind === 'powershell' ? `'${path.replaceAll("'", "''")}'` : `'${path.replaceAll("'", "'\"'\"'")}'`;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let backup;
  try { backup = await readSmallJson(join(root, 'local', 'claude-statusline-backup.json')); } catch { /* No stored command is safe to execute. */ }
  const originalCommand = isObject(backup?.statusLine) && typeof backup.statusLine.command === 'string' ? backup.statusLine.command : null;
  let child = null;
  let childDone = Promise.resolve(0);
  if (originalCommand && !originalCommand.toLowerCase().includes('claude-statusline-bridge.mjs')) {
    const shell = await resolveNativeShell();
    child = spawn(shell.path, shell.kind === 'powershell' ? ['-NoProfile', '-Command', originalCommand] : ['-c', originalCommand],
      { shell: false, windowsHide: true, stdio: ['pipe', 'inherit', 'inherit'] });
    child.stdin.on('error', () => {});
    childDone = new Promise(resolveExit => {
      child.once('error', () => resolveExit(1));
      child.once('exit', code => resolveExit(code ?? 1));
    });
    process.once('SIGTERM', () => { child.kill(); process.exit(143); });
    process.once('SIGINT', () => { child.kill(); process.exit(130); });
  }
  let chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    child?.stdin.write(chunk);
    bytes += chunk.length;
    if (bytes <= 2_000_000) chunks.push(chunk); else chunks = [];
  }
  child?.stdin.end();
  if (backup?.active === true && bytes <= 2_000_000) {
    try { await writeClaudeProjection(root, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch { /* Capture failure must not change the original status line or expose raw input. */ }
  }
  process.exitCode = await childDone;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.exitCode = 1; });
}
