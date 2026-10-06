# AI Usage Tracker Technical Plan

Date: October 5, 2026. Scope: a private Windows application under `D:/Meaningful/AI/ai-usage-tracker`.

## Architecture Decision

Use React + TypeScript + Vite for the browser and Node 24 `node:http` for one loopback server. Use Zod for shared validation and `playwright-core` only for the explicitly connected Cursor browser. Use installed Chrome; do not download a browser. JSON files are the local source of truth. No cloud service, telemetry, database, account token extraction, paid inference, or dependency on legacy project roots is required.

The server owns provider operations, storage, freshness, and action derivation. The UI displays the resulting snapshot and updates countdowns locally every second. A single shared EventSource invalidates the snapshot after changes. Each provider has an independent operation queue, timeout, error state, and refresh schedule; one broken connector cannot hold the others.

## File Ownership

| Lane | Files | Responsibility |
|---|---|---|
| Shared Contract | `shared/schema.ts` | Zod schemas and inferred TypeScript types; both app and server import this file |
| Frontend | `app/` | Dashboard, history, actions, connections/settings, labelled theme switch |
| Backend | `server/`, excluding connectors | HTTP guards, static serving, atomic store, history, SSE, scheduler, action derivation |
| Connectors | `server/connectors/`, `tools/` | Codex RPC, Claude bridge, Cursor browser, synthetic connector tests |
| Root Integration | Root config, docs, launch files | Package scripts, Vite/TS configuration, hooks, production verification |

Read `api-contract.md` before implementing. Freeze exported names there before parallel work; agree on changes before consuming them across lanes.

## Data and Persistence

- `local/state.json`: versioned settings, connection preferences/status, latest provider observations, and persisted action disposition. Initialize all connections disabled and all observations absent.
- `local/history/<provider>/<observation-id>.json`: one immutable normalized observation per meaningful quota change. No retention cap. List with cursor pagination; a page size limits an HTTP response, not the number of observations saved.
- `local/claude-inbox.json`: strict quota projection written atomically by the Claude bridge. No raw stdin, session ID, transcript path, working directory, or model text.
- `local/claude-statusline-backup.json`: original status-line configuration needed for restoration, kept private. Do not expose it through an API or log it.
- `local/browser-profiles/cursor/`: browser-managed session material. Never export cookies or storage state, attach to the user's normal profile, or send it to the UI.
- `local/server.lock`: PID/port for the single running instance. Distinguish a stale lock from an active process; do not kill unrelated processes.
- `out/`: ignored local validation artifacts; real-account screenshots belong here and never in tracked documentation.

Use one serialized store transaction queue per server. Validate before write, write a same-directory temporary file, close it, and rename with bounded Windows EPERM retries. The ETag is the SHA-256 of exact state bytes. If-Match is required for user settings/disposition writes, and mismatches return 412. Save a history observation before advancing the state pointer; an orphaned history file after a crash is harmless and recoverable. Do not silently replace malformed on-disk data with defaults; return a generic recoverable storage error and preserve the file.

Watch the state and Claude inbox files with debounce and periodic reconciliation to cover file replacement on Windows. One SSE `change` event carries only the current revision, never secrets or paths. On disconnect/reconnect or window focus the browser refetches `/api/status`.

## Provider Connectors

### Codex

On explicit Connect, discover the installed executable using a constrained known-install resolver. Run `app-server` directly with `shell: false`; allow only `initialize`, `initialized`, and `account/rateLimits/read`. Correlate request IDs, limit response bytes, apply a deadline, and terminate the child cleanly. Do not parse credential files or session logs. The standalone prototype has passed with the user's ordinary runtime permissions.

Prefer `rateLimitsByLimitId`; fall back to `rateLimits` only if the map is absent. Preserve all buckets and primary/secondary windows. `usedPercent` is percent consumed; derive remaining as `max(0, 100 - usedPercent)`. Epoch seconds become UTC ISO timestamps. Missing fields stay null. Discard account identity and unrelated response fields. Poll every five minutes while connected; throttle user refreshes and back off transient errors without clearing the last successful snapshot.

### Claude

Connect installs a reversible native status-line bridge only after the user clicks Connect. Read and modify only the Claude statusLine setting, with atomic/concurrent-change protection. Preserve the prior command and optional padding. Run that original command exactly as native Claude would, forward original stdin to it, and preserve its stdout/exit behavior. Do not log the input or command. Detect prior bridge installation and refuse recursive wrapping. Disconnect restores the backup only if the current command is still this app's bridge; if the user changed it later, leave their edit intact and explain the unresolved cleanup.

The bridge parses stdin in memory and writes only `rate_limits.five_hour` and `rate_limits.seven_day` numbers/reset timestamps. Record `receivedAt` on delivery but advance `observedAt` only when the normalized quota payload changes. Repeated cached status-line input must not look like a fresh provider observation. A missing rate_limits block is no new quota evidence; it cannot overwrite a last good snapshot with zero or erase it. Changed valid payloads may omit an expired window; the new observation then omits that window honestly.

Claude is a passive integration: normal Claude Code activity provides observations. Refresh rereads the inbox; it cannot independently query an idle subscription. An installed bridge with no observation is `waiting`, with clear UI instructions. Never start a model turn solely to populate the tracker.

### Cursor

Connect opens installed Chrome in a visible dedicated ignored profile at the official Cursor dashboard. Only the user can finish the provider's sign-in or challenges. No account collection starts before Connect. Refresh uses the same browser context to issue only `GET https://cursor.com/api/usage-summary`; do not expose arbitrary fetch URLs, account identity, browser automation, or debugging controls to the frontend.

Validate the response shape and project quota-only fields before returning to Node. Preserve reported billing-cycle bounds and included/on-demand/team distinctions. Amounts documented by the research parser are cents and must be converted once to USD; percentage fields are already on a 0–100 scale. Do not infer modern pool labels, aggregate disjoint pools, or convert missing values to zero. If current labels cannot be reconciled, display the recognized source field with an explicit verification limitation, not an invented allowance. Treat on-demand spend as a separate money meter; it is not free remaining quota.

Mark this undocumented connector experimental. Initial implementation is user-triggered refresh; background polling is disabled until live account reconciliation validates this version's units/pools and session behavior. Authentication or challenge failures preserve the old observation and offer Reconnect. Serialize browser use, enforce request timeouts/response limits, and close the app-owned browser on Disconnect or server shutdown.

## Time, Freshness, and Actions

Store UTC instants; validate a real IANA timezone in settings and default to `America/Los_Angeles`. Render resets with `Intl.DateTimeFormat`, including timezone. Use exact timestamps for countdowns; do not add 24 hours or seven days to infer the next reset. A passed `resetAt` sets `awaitingConfirmation` until a later provider observation reports a different/current window; it never changes usage to zero.

Separate stable window `key` from `cycleId` (the reported reset identity). Historical line segments cannot connect across cycle IDs, observation gaps, or incompatible units. An absent reset remains unknown. Freshness depends on `observedAt`, never the last refresh attempt or passive bridge receipt time. Default stale threshold is 15 minutes; the UI explains that Claude may be unchanged/cached and need native activity.

Derive actions deterministically from provider status and windows: disconnected, waiting, error, stale, awaiting confirmation, near limit, exhausted. The warning setting affects UI only. Store dismiss/reopen state by action condition identity, including cycle identity for quota actions. A new reset cycle creates a new action so an old dismissal cannot hide a new exhausted window. Resolved actions remain in action history; reconnecting does not delete it.

## Local Security

Bind `127.0.0.1` only. Check exact loopback Host plus port. Every mutation requires `X-AI-Usage-Tracker: 1`; reject a present Origin unless it matches the loopback app origin. Require JSON content type. Do not enable CORS. Validate request targets before URL/URI parsing, contain static paths under `dist`, return 400 for malformed paths, and handle `clientError` without terminating the server. Reject oversized bodies with 413 and drain safely. CSP permits only bundled same-origin scripts/styles and same-origin connections; no remote fonts or analytics. Static HTML and API responses use `Cache-Control: no-store`; add `X-Content-Type-Options: nosniff` and a deny-framing policy.

Known directory exclusions and the global secret scanner gate every commit/push. `local/`, `private/`, `out/`, browser profiles, runtime locks, and actual observations are ignored. Generic operational errors must not include raw provider responses, cookies, command arguments, paths containing account identity, or JSON parser source snippets.

## Verification and Delivery

1. Unit-test adapter normalization using synthetic fixtures: missing fields, every window/pool, 0/100/>100 percentages, fractional percentages, malformed data, timestamps, and provider-specific units. Test history segmentation, passive freshness, and reset expiry separately from rendering.
2. Exercise the HTTP server on a temporary root: Host/Origin/header guards, malformed raw request targets, traversal, body limits, 412 concurrent edits, restart persistence, isolated connector errors, SSE invalidation, and preserved bad-file handling.
3. Build with TypeScript + Vite. Run the actual production server and inspect dashboard, history, actions, and settings with both themes at desktop and narrow widths. Assert no horizontal overflow, usable keyboard controls, persistence after reload, and no console errors.
4. Run the prescribed QA sweep on the running production build. Resolve must-fix findings and rerun affected checks.
5. Reconcile each actually connected provider against its official usage surface. Report synthetic validation and live provider validation separately. Missing sign-in or absent Claude activity is a named incomplete integration test, not fabricated coverage.
6. Register daily and dev launch configurations inside this project. Back up validated source to a private GitHub repository through the privacy gate. No deployment or quota data is pushed.
