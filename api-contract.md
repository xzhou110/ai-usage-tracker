# AI Usage Tracker API Contract

Date: October 5, 2026. Shared types live in `shared/schema.ts`. JSON fields use camelCase. Unknown numeric/time values are `null`, never zero or empty strings. All instants are UTC ISO 8601 strings. Provider responses remain server-side.

## Shared Types

Sidebar addition: each provider has `membership: { plan: string | null, price: number | null, currency: string, billingPeriod: 'month' | 'year' | 'unknown' }`. These are user-entered local metadata; price is nonnegative and currency is a three-letter uppercase code. Old state defaults to unknown plan/price, USD, and unknown period without removing observations or history. `PUT /api/providers/:id/membership` validates the complete object and requires the standard mutation headers plus `If-Match`; it returns the updated snapshot or 412 on a stale revision. It never mutates quota. Health now includes the application marker and `membershipApi: 1` so the desktop can reject an incompatible service.

```ts
type ProviderId = 'claude' | 'codex' | 'cursor';
type IsoTime = string;
type ConnectionStatus = 'disconnected' | 'connecting' | 'waiting' | 'connected' | 'error';
type CollectionMode = 'automatic' | 'passive' | 'experimental';
type Freshness = 'unknown' | 'fresh' | 'stale';

interface QuotaWindow {
  key: string;                 // Stable source bucket + window/pool key; no account ID.
  label: string;               // Provider-reported or conservatively named label.
  kind: 'quota' | 'spend';      // Spend is shown separately from included allowance.
  scope: 'personal' | 'team' | 'unknown';
  usedPercent: number | null;  // Consumed, >= 0; values above 100 are preserved.
  used: number | null;
  limit: number | null;
  unit: 'percent' | 'USD' | 'requests' | 'tokens' | null;
  resetAt: IsoTime | null;
  durationMinutes: number | null;
  cycleId: string | null;      // Reported reset or billing cycle; null if unknown.
  detail: string | null;       // Static adapter explanation; never raw provider text.
}

interface Observation {
  id: string;                 // Locally generated opaque ID.
  provider: ProviderId;
  observedAt: IsoTime;         // Poll completion or changed Claude projection time.
  receivedAt: IsoTime;
  source: 'codex-app-server' | 'claude-statusline' | 'claude-desktop-mod' | 'cursor-browser';
  windows: QuotaWindow[];
}

interface ProviderState {
  id: ProviderId;
  name: 'Claude' | 'Codex' | 'Cursor';
  mode: CollectionMode;
  status: ConnectionStatus;
  enabled: boolean;
  verified: boolean;          // True only after documented live reconciliation.
  observation: Observation | null;
  freshness: Freshness;
  lastAttemptAt: IsoTime | null;
  lastSuccessAt: IsoTime | null;
  nextRefreshAt: IsoTime | null;
  message: string;            // Safe user-facing state explanation.
  errorCode: string | null;   // Small allowlisted operational code.
  sourceUrl: string;          // Fixed official usage/dashboard URL.
}

interface Settings {
  timezone: string;           // Valid IANA name; default America/Los_Angeles.
  warningPercent: number;     // 1..100; default 80; display threshold only.
  staleAfterMinutes: number;  // Positive integer; default 15.
}

type ActionKind = 'disconnected' | 'waiting' | 'error' | 'stale'
  | 'awaiting-confirmation' | 'near-limit' | 'exhausted';

interface UsageAction {
  id: string;                // Stable condition ID including cycle ID where relevant.
  provider: ProviderId;
  windowKey: string | null;
  kind: ActionKind;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  state: 'open' | 'dismissed' | 'resolved';
  firstSeenAt: IsoTime;
  updatedAt: IsoTime;
  dismissedAt: IsoTime | null;
  resolvedAt: IsoTime | null;
}

interface DashboardSnapshot {
  revision: string;          // Same value as the unquoted state ETag.
  serverTime: IsoTime;
  settings: Settings;
  providers: ProviderState[]; // Always exactly Claude, Codex, Cursor in this order.
  actions: UsageAction[];     // Open, dismissed, and resolved; no history truncation.
}

interface ApiError {
  error: { code: string; message: string };
}

interface HistoryPage {
  observations: Observation[]; // Newest first; immutable records.
  nextCursor: string | null;
}

interface ProviderOperation {
  provider: ProviderId;
  accepted: boolean;
  message: string;
}
```

Use strict Zod objects for all client mutation bodies and persisted records. Validate finite numbers, dates with timezone suffix, provider enums, bounded safe labels/keys, and explicit nullability. Native payload adapters permit only recognized shapes and discard extra fields. No manual observation route or input exists in this release.

## Routes

All API responses have `Cache-Control: no-store`. Every mutation below requires `Content-Type: application/json` and `X-AI-Usage-Tracker: 1`. Validate a present Origin and exact Host/port on every route. Return JSON `ApiError` with generic safe messages on failure.

| Method and Route | Request | Response |
|---|---|---|
| `GET /api/status` | None | `200 DashboardSnapshot`, `ETag: "<revision>"` |
| `GET /api/settings` | None | `200 Settings`, state ETag |
| `PUT /api/settings` | `Settings`, required current `If-Match` | `200 DashboardSnapshot`, new ETag |
| `POST /api/providers/:provider/connect` | `{}` | `202 ProviderOperation`; starts connection; status/SSE reveals outcome |
| `POST /api/providers/:provider/disconnect` | `{}` | `200 DashboardSnapshot`; stops collection and keeps last observation/history |
| `POST /api/providers/:provider/refresh` | `{}` | `202 ProviderOperation`; refreshes only if already enabled |
| `POST /api/refresh` | `{}` | `202 { operations: ProviderOperation[] }`; independently starts each enabled provider |
| `GET /api/history?provider=codex&cursor=...` | Provider optional for all; opaque cursor optional | `200 HistoryPage`; page size 100, continue until nextCursor null |
| `POST /api/actions/:id/dismiss` | `{}`, required current `If-Match` | `200 DashboardSnapshot`, new ETag |
| `POST /api/actions/:id/reopen` | `{}`, required current `If-Match` | `200 DashboardSnapshot`, new ETag; resolved conditions cannot reopen |
| `GET /api/events` | One shared browser EventSource | SSE `change` event with `{"revision":"..."}`; heartbeat comments |
| `GET /api/health` | None | `200 {"ok":true}`; no account, path, or process details |

Connection/refresh operations return promptly and are serialized per provider. Connect is idempotent while already connected/connecting. Cursor Connect/Refresh read only the last paired-browser observation and never open a login window or manufacture a new timestamp. Refresh All excludes Cursor and directs the user to Sync Now in the extension. Refresh never auto-enables a provider. For Claude, Refresh imports the latest bridge projection but does not claim new source freshness. A duplicate queued operation may return accepted false with an explanation; it is not a second concurrent collector.

### Cursor Browser Extension Routes

`POST /api/cursor-browser/pairing` uses the ordinary app guard and an empty JSON body. It returns a 128-bit one-use code and `expiresAt`, ten minutes later. Keep this response out of logs and screenshots; a newer code replaces the pending one.

Only `POST /api/cursor-browser/pair` and `/api/cursor-browser/reading` accept cross-origin writes. They require exact `Host: 127.0.0.1:<port>`, a browser-supplied `chrome-extension://<32-letter-id>` Origin, JSON, and a 32 KB projected-message transport limit. Their OPTIONS handlers advertise only POST plus Content-Type/Authorization. No other route receives extension CORS permissions.

- Pair takes strict `{ code }`, consumes it once, binds a random 256-bit bearer to that Origin, and returns `{ token }` only to the extension. The server persists its hash, never its raw value.
- Reading requires that bearer and bound Origin. It takes strict `{ observedAt, payload }`; payload contains only numeric/null quota pools and billing-cycle timestamps. A source timestamp more than one minute away from this machine's current time is rejected. Unknown fields or unsupported quota shapes return safe 422 errors. Success persists a normalized observation and enables Cursor with `verified: false`.
- Disconnect serializes with incoming reads, clears local browser authorization and pending pairing codes, and preserves tracker history. Revocation is available even before the first accepted reading. The extension drops a revoked token after a 403.

The frontend always refetches status after operations and SSE changes. Update countdowns locally without a network request each second. Reconcile server clock offset from serverTime. Preserve scroll/focus during refresh. Theme is an explicit Light/Dark localStorage preference, separate from data settings.

## Errors and Concurrency

| Status | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed target, JSON, cursor, or query |
| 403 | `FORBIDDEN` | Host, Origin, or mutation-header rejected |
| 404 | `NOT_FOUND` | Unknown route/provider/action |
| 409 | `CONFLICT` | Refresh of disabled provider, reopen of resolved condition, or installation conflict |
| 412 | `PRECONDITION_FAILED` | State changed since the caller's ETag; refetch before retry |
| 413 | `PAYLOAD_TOO_LARGE` | Body exceeds transport safety limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Mutation is not JSON |
| 422 | `VALIDATION_ERROR` | Body shape, timezone, or value fails schema |
| 428 | `PRECONDITION_REQUIRED` | Required If-Match absent |
| 500 | `STORAGE_ERROR` | Local state could not be safely read or saved |
| 503 | `UNAVAILABLE` | Requested local integration prerequisite unavailable |

Provider failures normally update that provider's safe error state and emit SSE; they do not convert the entire dashboard into HTTP 500. Last successful observation and its original timestamp survive errors and disconnects. Never retry a rejected stale ETag automatically with a newly fetched ETag, because that silently overwrites a competing edit. Tell the user settings changed and offer reload/reapply.

## Derived Display Rules

- `remainingPercent = max(0, 100 - usedPercent)` only when usedPercent is known. The progress visual clamps to 0..100; the displayed consumed value preserves overage.
- A quota window is awaiting confirmation when resetAt is at/before server-adjusted now and no newer reported cycle supersedes it. Display its recorded usage as an old observation, never current zero.
- Upcoming Resets includes known future quota reset timestamps. Expired resets move into awaiting-confirmation status instead of remaining a future countdown.
- On-demand money meters are labelled separately and cannot become a provider's free-quota headline.
- No overall cross-provider score or averaged pool percentage. The most constrained comparable quota may be highlighted, with the actual window label visible.
- History has separate series for provider + window key + cycle ID + unit. Do not interpolate across missing quota observations or stale gaps. Display observation time and source.
- Disconnected/no-observation cards contain an explicit Connect action and source explanation. They contain no demo numbers.
