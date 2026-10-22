import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { acquireServerLock, checkMutation, createEventHub, createStaticHandler, hostAllowed, listenLoopback, originAllowed, parseRequestTarget, readJsonBody } from '@xuseak/local-app-kit';
import type { Handler } from '@xuseak/local-app-kit';
import { SettingsSchema, ProviderIdSchema, MembershipSchema } from '../shared/schema.ts';
import type { Connectors, DashboardSnapshot } from '../shared/schema.ts';
import { AppError } from './errors.ts';
import { StateStore } from './store.ts';
import { ProviderService } from './providers.ts';
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
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const EXTRA_HEADERS = { 'x-frame-options': 'DENY', 'permissions-policy': 'camera=(), microphone=(), geolocation=()' };
/** The pages the single-page app owns; any other extension-less path is a 404, never index.html. */
const ROUTES = ['/', '/dashboard', '/history', '/actions', '/connections', '/settings'];
const MUTATION_HEADER = 'x-ai-usage-tracker';

function commonHeaders(response: ServerResponse): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', CSP);
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

/** The kit validates the raw target before URL normalisation can erase traversal; every bad shape is a 400 here. */
function parseTarget(request: IncomingMessage, port: number): URL {
  const target = parseRequestTarget(request.url, port);
  if (!target.ok) throw new AppError(400, 'BAD_REQUEST', 'The request target is invalid.');
  return target.url;
}

/** Host and Origin on every request, the tracker header and a JSON body on mutations: the kit's checks, this app's wording. */
function guard(request: IncomingMessage, port: number, devOrigin?: string): void {
  const extraOrigins = devOrigin ? [devOrigin] : [];
  if (!hostAllowed(request, port)) throw new AppError(403, 'FORBIDDEN', 'Only this local tracker can access this endpoint.');
  if (!originAllowed(request, port, extraOrigins)) throw new AppError(403, 'FORBIDDEN', 'The request origin is not allowed.');
  const mutation = checkMutation(request, { port, header: MUTATION_HEADER, requireJson: true, extraOrigins });
  if (!mutation.ok) {
    if (mutation.status === 415) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use a JSON request body.');
    throw new AppError(403, 'FORBIDDEN', 'The tracker request header is required.');
  }
}

/** The kit reads the body (413 while draining an oversized one, never an echo of a malformed one); the envelope is this app's. */
async function body(request: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  const result = await readJsonBody(request, limit);
  if (result.ok) return result.value;
  if (result.status === 413) throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request exceeds its transport size limit.');
  const message = result.reason === 'interrupted' ? 'The request was interrupted.' : result.reason === 'unreadable' ? 'The request body could not be read.' : 'The JSON request body is invalid.';
  throw new AppError(400, 'BAD_REQUEST', message);
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

export async function startServer(options: ServerOptions) {
  const root = path.resolve(options.root);
  const requestedPort = options.port ?? 8175;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new AppError(400, 'BAD_REQUEST', 'Choose a valid local port.');
  if (options.devOrigin && !/^http:\/\/127\.0\.0\.1:\d+$/.test(options.devOrigin)) throw new AppError(400, 'BAD_REQUEST', 'Development origin must be an explicit loopback origin.');
  const lock = await acquireServerLock(path.join(root, 'local'), { port: requestedPort, appName: 'AI Usage Tracker' });
  if (!lock.ok) throw lock.reason === 'io' ? new AppError(500, 'STORAGE_ERROR', lock.message) : new AppError(409, 'CONFLICT', lock.message);
  const unlock = lock.release;
  const store = new StateStore(root);
  const providers = new ProviderService(store, options.connectors, options.throttleMs);
  const events = createEventHub({ heartbeatMs: 15_000 });
  let port = requestedPort;
  let closed = false;
  let unsubscribe = () => {};
  // The API handler. The kit's static handler sits in front of it: Host check, request-target check, dist/ for pages.
  const api: Handler = (request, response) => {
    commonHeaders(response);
    const handle = async () => {
      const target = parseTarget(request, port);
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
        events.open(request, response);
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
  };
  // The front handler is assembled once the port is known (port 0 in tests picks a free one); nothing can arrive before.
  let serve: Handler = (_request, response) => { response.statusCode = 503; response.end(); };
  let listening!: Extract<Awaited<ReturnType<typeof listenLoopback>>, { ok: true }>;
  try {
    await store.initialize(options.watch ?? true);
    await providers.start(options.poll ?? true);
    unsubscribe = store.subscribe(revision => { events.broadcast('change', { revision }); });
    const result = await listenLoopback({ port: requestedPort, handler: (request, response) => serve(request, response), requestTimeoutMs: 30_000, headersTimeoutMs: 15_000, log: () => {} });
    if (!result.ok) throw new Error(result.message);
    listening = result;
    port = result.port;
    serve = createStaticHandler({
      dist: options.distDir ?? path.join(projectRoot, 'dist'), port, api, fallback: ROUTES, assetCache: 'no-store', csp: CSP, headers: EXTRA_HEADERS,
      missingDistMessage: 'This file is unavailable. Build the app before opening it.',
    });
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
    events.close();
    let failure: unknown;
    try { await providers.close(); } catch (error) { failure = error; }
    try { await listening.close(); await store.close(); } finally { await unlock(); }
    if (failure) throw failure;
  };
  return { server: listening.server, store, providers, port, url: listening.url, close };
}
