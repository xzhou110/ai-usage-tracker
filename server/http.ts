import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SettingsSchema, ProviderIdSchema, MembershipSchema } from '../shared/schema.ts';
import type { Connectors, DashboardSnapshot } from '../shared/schema.ts';
import { AppError } from './errors.ts';
import { StateStore } from './store.ts';
import { ProviderService } from './providers.ts';
import { acquireLock } from './lock.ts';
import { CursorConnector, parseCursorPayload } from './connectors/cursor.ts';
import { extensionOrigin } from './connectors/cursor-browser.ts';

export interface ServerOptions {
  root: string;
  port?: number;
  distDir?: string;
  connectors: Connectors;
  watch?: boolean;
  poll?: boolean;
  throttleMs?: number;
  /** Development only: explicit loopback Vite origin. Production leaves this unset. */
  devOrigin?: string;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY_BYTES = 1024 * 1024;
const emptyBody = z.object({}).strict();
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2' };

function commonHeaders(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

function json(response: ServerResponse, status: number, value: unknown, head = false): void {
  const bytes = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(bytes));
  response.end(head ? undefined : bytes);
}

function snapshotResponse(response: ServerResponse, snapshot: DashboardSnapshot, head = false): void {
  response.setHeader('ETag', `"${snapshot.revision}"`);
  json(response, 200, snapshot, head);
}

function fail(response: ServerResponse, error: unknown, head = false): void {
  if (response.headersSent) { response.end(); return; }
  const safe = error instanceof AppError ? error : new AppError(500, 'STORAGE_ERROR', 'The request could not be safely completed.');
  json(response, safe.status, { error: { code: safe.code, message: safe.message } }, head);
}

function parseTarget(request: IncomingMessage): URL {
  const raw = request.url ?? '';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.includes('#') || /[\u0000-\u0020\u007f]/.test(raw)) throw new AppError(400, 'BAD_REQUEST', 'The request target is invalid.');
  try {
    // Validate before URL normalization can erase traversal segments.
    const decoded = decodeURIComponent(raw.split('?')[0]);
    if (decoded.includes('\\') || decoded.includes(':') || decoded.includes('%') || decoded.startsWith('//') || /[\u0000-\u001f\u007f]/.test(decoded)) throw new Error();
    const segments = decoded.split('/').filter(Boolean);
    if (segments.some(segment => segment.startsWith('.') || /[. ]$/.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) throw new Error();
    const url = new URL(raw, 'http://127.0.0.1');
    // Query decoding must also reject malformed escapes rather than silently substituting them.
    decodeURIComponent(url.search.replaceAll('+', ' '));
    return url;
  } catch { throw new AppError(400, 'BAD_REQUEST', 'The request target is invalid.'); }
}

function guard(request: IncomingMessage, port: number, devOrigin?: string): void {
  const host = request.headers.host;
  if (!host || ![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) throw new AppError(403, 'FORBIDDEN', 'Only this local tracker can access this endpoint.');
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== `http://${host}` && origin !== devOrigin) throw new AppError(403, 'FORBIDDEN', 'The request origin is not allowed.');
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    if (request.headers['x-ai-usage-tracker'] !== '1') throw new AppError(403, 'FORBIDDEN', 'The tracker request header is required.');
    if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(request.headers['content-type'] ?? '')) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use a JSON request body.');
  }
}

async function body(request: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  const declared = request.headers['content-length'];
  if (declared && Number(declared) > limit) {
    request.resume();
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request exceeds its transport size limit.');
  }
  return new Promise((resolve, reject) => {
    let total = 0;
    let rejected = false;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      if (rejected) return;
      total += chunk.length;
      if (total > limit) {
        rejected = true;
        chunks.length = 0;
        reject(new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request exceeds its transport size limit.'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new AppError(400, 'BAD_REQUEST', 'The JSON request body is invalid.')); }
    });
    request.on('aborted', () => reject(new AppError(400, 'BAD_REQUEST', 'The request was interrupted.')));
    request.on('error', () => reject(new AppError(400, 'BAD_REQUEST', 'The request body could not be read.')));
  });
}

function expectedRevision(request: IncomingMessage): string {
  const value = request.headers['if-match'];
  if (typeof value !== 'string' || !value) throw new AppError(428, 'PRECONDITION_REQUIRED', 'Reload the current data before applying changes.');
  return value;
}

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(422, 'VALIDATION_ERROR', 'The submitted values are invalid. Check the fields and try again.');
  return result.data;
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, pathname: string, distDir: string): Promise<void> {
  if (!['GET', 'HEAD'].includes(request.method ?? '')) throw new AppError(404, 'NOT_FOUND', 'This route does not exist.');
  const decoded = decodeURIComponent(pathname);
  const routes = new Set(['/', '/dashboard', '/history', '/actions', '/connections', '/settings']);
  const relative = routes.has(decoded) ? 'index.html' : decoded.slice(1);
  if (!relative || !path.extname(relative)) throw new AppError(404, 'NOT_FOUND', 'This page does not exist.');
  try {
    const base = await realpath(distDir);
    const candidate = await realpath(path.resolve(base, relative));
    const contained = path.relative(base, candidate);
    if (!contained || contained.startsWith('..') || path.isAbsolute(contained) || !(await stat(candidate)).isFile()) throw new Error();
    const extension = path.extname(candidate).toLowerCase();
    if (!mime[extension]) throw new Error();
    const bytes = await readFile(candidate);
    response.statusCode = 200;
    response.setHeader('Content-Type', mime[extension]);
    response.setHeader('Content-Length', bytes.length);
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { throw new AppError(404, 'NOT_FOUND', 'This file is unavailable. Build the app before opening it.'); }
}

export async function startServer(options: ServerOptions) {
  const root = path.resolve(options.root);
  const requestedPort = options.port ?? 8175;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new AppError(400, 'BAD_REQUEST', 'Choose a valid local port.');
  if (options.devOrigin && !/^http:\/\/127\.0\.0\.1:\d+$/.test(options.devOrigin)) throw new AppError(400, 'BAD_REQUEST', 'Development origin must be an explicit loopback origin.');
  const unlock = await acquireLock(root, requestedPort);
  const store = new StateStore(root);
  const providers = new ProviderService(store, options.connectors, options.throttleMs);
  const events = new Set<ServerResponse>();
  let port = requestedPort;
  let closed = false;
  let unsubscribe = () => {};
  const server = http.createServer((request, response) => {
    commonHeaders(response);
    const handle = async () => {
      const target = parseTarget(request);
      const pathname = decodeURIComponent(target.pathname);
      const method = request.method ?? 'GET';
      // Only these two write-only routes accept an extension Origin. The rest of
      // the application retains the existing same-origin guard unchanged.
      if (pathname === '/api/cursor-browser/pair' || pathname === '/api/cursor-browser/reading') {
        const origin = request.headers.origin ?? '';
        if (request.headers.host !== `127.0.0.1:${port}` || !extensionOrigin.test(origin) || target.search) throw new AppError(403, 'FORBIDDEN', 'This browser request is not allowed.');
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        if (method === 'OPTIONS') {
          response.setHeader('Access-Control-Allow-Methods', 'POST');
          response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          response.statusCode = 204; response.end(); return;
        }
        if (method !== 'POST' || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(request.headers['content-type'] ?? '')) throw new AppError(403, 'FORBIDDEN', 'Use a JSON browser update.');
        if (!(options.connectors.cursor instanceof CursorConnector)) throw new AppError(503, 'UNAVAILABLE', 'Cursor browser connection is unavailable.');
        const browser = options.connectors.cursor.browser;
        const input = await body(request, 32 * 1024);
        if (pathname.endsWith('/pair')) {
          const data = validate(z.object({ code: z.string().regex(/^[a-f0-9]{32}$/) }).strict(), input);
          json(response, 200, await browser.pair(origin, data.code));
        } else {
          const authorization = request.headers.authorization ?? '';
          const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1] ?? '';
          await browser.accept(origin, token, input, parseCursorPayload, observation => providers.receiveCursor(observation));
          json(response, 200, { ok: true });
        }
        return;
      }
      guard(request, port, options.devOrigin);
      const head = method === 'HEAD';
      const get = method === 'GET' || head;
      if (!pathname.startsWith('/api/') && pathname !== '/api') return serveStatic(request, response, target.pathname, options.distDir ?? path.join(projectRoot, 'dist'));
      if (get && pathname === '/api/health') {
        providers.checkHealth();
        await store.snapshot();
        json(response, 200, { ok: true, app: 'ai-usage-tracker', membershipApi: 1 }, head);
        return;
      }
      if (get && pathname === '/api/status') {
        const snapshot = await store.snapshot();
        providers.checkHealth();
        snapshotResponse(response, snapshot, head);
        return;
      }
      if (method === 'POST' && pathname === '/api/cursor-browser/pairing') {
        validate(emptyBody, await body(request));
        if (!(options.connectors.cursor instanceof CursorConnector)) throw new AppError(503, 'UNAVAILABLE', 'Cursor browser connection is unavailable.');
        json(response, 200, await options.connectors.cursor.browser.issuePairing());
        return;
      }
      // Native mod requests use the ordinary localhost mutation guard above.
      // No extension CORS exception, authentication cookies, or raw session data.
      if (method === 'POST' && pathname === '/api/claude-desktop/reading') {
        await providers.receiveClaudeDesktop(await body(request, 8192));
        json(response, 200, { ok: true });
        return;
      }
      if (get && pathname === '/api/settings') {
        const snapshot = await store.snapshot();
        response.setHeader('ETag', `"${snapshot.revision}"`);
        json(response, 200, snapshot.settings, head);
        return;
      }
      if (method === 'PUT' && pathname === '/api/settings') {
        const expected = expectedRevision(request);
        const settings = validate(SettingsSchema, await body(request));
        snapshotResponse(response, await store.transaction(state => { state.settings = settings; }, expected));
        return;
      }
      if (get && pathname === '/api/history') {
        if ([...target.searchParams.keys()].some(key => !['provider', 'cursor'].includes(key)) || target.searchParams.getAll('provider').length > 1 || target.searchParams.getAll('cursor').length > 1) throw new AppError(400, 'BAD_REQUEST', 'The history query is invalid.');
        const rawProvider = target.searchParams.get('provider');
        const rawCursor = target.searchParams.get('cursor');
        const provider = rawProvider === null ? undefined : ProviderIdSchema.safeParse(rawProvider);
        if (provider && !provider.success || rawCursor === '') throw new AppError(400, 'BAD_REQUEST', 'The history query is invalid.');
        json(response, 200, await store.history(provider?.success ? provider.data : undefined, rawCursor ?? undefined), head);
        return;
      }
      if (get && pathname === '/api/events') {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/event-stream');
        response.setHeader('Connection', 'keep-alive');
        response.setHeader('X-Accel-Buffering', 'no');
        if (head) { response.end(); return; }
        response.flushHeaders();
        response.write(': connected\n\n');
        events.add(response);
        const timer = setInterval(() => { if (!response.write(': heartbeat\n\n')) response.end(); }, 15_000);
        timer.unref();
        response.on('close', () => { clearInterval(timer); events.delete(response); });
        return;
      }
      const providerRoute = pathname.match(/^\/api\/providers\/([^/]+)\/(connect|disconnect|refresh)$/);
      const membershipRoute = pathname.match(/^\/api\/providers\/([^/]+)\/membership$/);
      if (method === 'PUT' && membershipRoute) {
        const parsed = ProviderIdSchema.safeParse(membershipRoute[1]);
        if (!parsed.success) throw new AppError(404, 'NOT_FOUND', 'This provider does not exist.');
        const expected = expectedRevision(request);
        const membership = validate(MembershipSchema, await body(request));
        snapshotResponse(response, await store.transaction(state => {
          state.providers.find(provider => provider.id === parsed.data)!.membership = membership;
        }, expected));
        return;
      }
      if (method === 'POST' && providerRoute) {
        const parsed = ProviderIdSchema.safeParse(providerRoute[1]);
        if (!parsed.success) throw new AppError(404, 'NOT_FOUND', 'This provider does not exist.');
        validate(emptyBody, await body(request));
        if (providerRoute[2] === 'disconnect') snapshotResponse(response, await providers.disconnect(parsed.data));
        else json(response, 202, await providers.request(parsed.data, providerRoute[2] as 'connect' | 'refresh'));
        return;
      }
      if (method === 'POST' && pathname === '/api/refresh') {
        validate(emptyBody, await body(request));
        json(response, 202, { operations: await providers.refreshAll() });
        return;
      }
      const actionRoute = pathname.match(/^\/api\/actions\/([^/]+)\/(dismiss|reopen)$/);
      if (method === 'POST' && actionRoute) {
        const expected = expectedRevision(request);
        validate(emptyBody, await body(request));
        // Reconcile elapsed conditions before evaluating a disposition write.
        await store.snapshot();
        snapshotResponse(response, await store.transaction(state => {
          const action = state.actions.find(item => item.id === actionRoute[1]);
          if (!action) throw new AppError(404, 'NOT_FOUND', 'This action no longer exists.');
          if (action.state === 'resolved') throw new AppError(409, 'CONFLICT', 'This condition has resolved and cannot be reopened or dismissed.');
          const timestamp = new Date().toISOString();
          action.state = actionRoute[2] === 'dismiss' ? 'dismissed' : 'open';
          action.dismissedAt = actionRoute[2] === 'dismiss' ? timestamp : null;
          action.updatedAt = timestamp;
        }, expected));
        return;
      }
      throw new AppError(404, 'NOT_FOUND', 'This API route does not exist.');
    };
    void handle().catch(error => {
      request.resume();
      fail(response, error, request.method === 'HEAD');
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  try {
    await store.initialize(options.watch ?? true);
    await providers.start(options.poll ?? true);
    unsubscribe = store.subscribe(revision => {
      const event = `event: change\ndata: ${JSON.stringify({ revision })}\n\n`;
      for (const response of events) if (!response.write(event)) response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(requestedPort, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error();
    port = address.port;
  } catch (error) {
    unsubscribe();
    await providers.close().catch(() => {});
    await store.close();
    await unlock();
    throw error;
  }
  const close = async () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    for (const response of events) response.end();
    const stopped = new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
    let failure: unknown;
    try { await providers.close(); } catch (error) { failure = error; }
    try { await stopped; await store.close(); } finally { await unlock(); }
    if (failure) throw failure;
  };
  return { server, store, providers, port, url: `http://127.0.0.1:${port}`, close };
}
