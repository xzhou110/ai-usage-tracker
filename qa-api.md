# AI Usage Tracker API and Fix Refutation QA

Date: October 5, 2026. This independent review used the QA-sweep checklist. All runtime probes used generated temporary directories, fake provider connectors, and ephemeral ports. The real dashboard servers on 8175/8176 were not accessed or changed. No real account observations, native account settings, credentials, transcripts, or existing private storage were read. Temporary servers and files were cleaned up after testing.

## Finding Refutations

| Original Finding | Before | Independent After Evidence | Outcome |
|---|---|---|---|
| R1: Failed Claude installation falsely recovers through passive Refresh | Error became waiting with “Bridge connected,” despite no successful installation | Real `ClaudeConnector` pointed at generated malformed native-settings fixture and an old synthetic inbox. After failed Connect, automatic Refresh retained `status: error`, returned `CLAUDE_BRIDGE_NOT_CONNECTED`, and did not import the old observation. | Fixed |
| R2: Cursor cannot reopen after process restart | Persisted connected status prevented connector Connect from running | Generated connected state passed through new `start(false)` became waiting. Explicit Connect was accepted and called the fake connector once. | Restart path fixed |
| R2: Cursor cannot reopen after browser closes during the same process | A connected provider still rejected Open Cursor Sign-In before its connector could reopen the missing browser | First independent recheck still reproduced the bug. Authorized follow-up changed only the provider Connect short-circuit and added a backend regression. The second explicit Cursor Connect now reaches its connector; a concurrent duplicate is rejected; the last observation survives the resulting waiting state. | Fixed During QA |
| R3: Stale-lock recovery admits multiple writers | 30/30 concurrent rounds admitted multiple owners, maximum five | Repeated 50 fresh-root rounds with 20 simultaneous contenders using distinct requested ports. Every round admitted exactly one owner: minimum 1, maximum 1, double-owner rounds 0. | Fixed |

The Cursor reconnect fix is in `server/providers.ts`; its synthetic regression is in `server/backend.test.ts`. The service now delegates explicit Cursor Connect even when saved quota status remains connected. Existing in-flight/connecting protection still prevents overlapping connector calls. Browser session existence and the last known quota reading are separate states, which is why a saved connected reading cannot suppress the user's request to reopen sign-in.

## API and Security Results

| Check | Observed Evidence |
|---|---|
| Host and Origin | Foreign Host and foreign Origin each returned 403 on `/`, `/settings`, `/api/status`, `/api/settings`, `/api/history`, `/api/health`, and `/api/events`. |
| HTML headers | HTTP 200, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, restrictive CSP including `frame-ancestors 'none'`, and no CORS allow-origin header. |
| Raw request parsing | Raw `//`, literal/encoded parent traversal, backslash traversal, double encoding, Windows drive paths, reserved device filenames, trailing encoded spaces, malformed query escapes, NUL, and absolute-form targets returned 400. The listener remained healthy. |
| Static containment | A junction inside the generated static directory pointing outside it could not expose `outside.json`: 404. `/local/state.json` also returned 404. |
| Mutation boundary | Missing tracker header: 403. Wrong content type: 415. Unexpected strict-body field: 422. Malformed JSON: 400 without echoing synthetic input. |
| Oversize body | A body exceeding 1 MiB delivered HTTP 413 to the client; subsequent health check returned 200. |
| Concurrency and failed writes | Missing If-Match: 428. Stale If-Match: 412. Invalid timezone: 422. Rejected writes left state bytes identical. Two simultaneous valid settings writes using the same revision returned exactly 200 and 412. |
| HEAD and OPTIONS | HEAD returned 200 with empty bodies for status, settings, history, health, events, and a static JS asset. OPTIONS without the mutation guard returned 403; guarded OPTIONS returned 404 without mutation. |
| SSE | Stream connected, emitted exactly one revision event for one settings change, and sent its 15-second heartbeat. No quota windows, settings body, or synthetic private marker appeared in events. |

## Reproduction and Test Evidence

Run `npm test -- server/backend.test.ts` from this project to reproduce the checked-in loopback, ETag, provider lifecycle, lock recovery, and SSE regression suite. It uses temporary roots and fake account connectors. **19/19 backend tests passed** after the Cursor follow-up fix under normal runtime permissions.

The independent lock stress used this core operation, repeated 50 times in newly generated temporary directories:

```js
await writeFile(lockPath, JSON.stringify({
  pid: 2147483647, port: 0, token: 'synthetic'
}));
const results = await Promise.allSettled(
  Array.from({ length: 20 }, (_, index) => acquireLock(root, 20000 + index))
);
assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
```

Successful owners were released only after counting them. Each generated root was verified to remain beneath the temporary directory before cleanup. The API probes used `startServer({ root: generatedRoot, port: 0, connectors: fakeConnectors, watch: false, poll: false })`, raw TCP for targets that fetch would normalize, and a 15.2-second SSE observation. All seven grouped adversarial checks passed.

## Remaining Limits

No unresolved must-fix API/security findings remain from this review. Actual Cursor browser reopening/sign-in and live provider reconciliation were not exercised here; this lane was intentionally limited to synthetic runtime state and isolated HTTP probes. Claude remains passive during ordinary Claude Code use, and Cursor remains experimental pending actual-account reconciliation. Browser layout and theme acceptance belong to the parent production-browser QA lane.
