# AI Usage Tracker Independent Code Review

Reviewed October 5, 2026. Scope: shared schema, provider adapters, passive Claude bridge, provider lifecycle, HTTP/storage boundaries, and frontend state handling. Only source, documentation, and synthetic inputs were read. No real account endpoints, native account settings, credentials, transcripts, or existing private/runtime data were accessed. No production server was started or stopped.

## Final Disposition

All three findings below were fixed and independently retested. Claude refresh verifies installation; Cursor reconnect recovers after restart and browser closure; stale-lock recovery admits exactly one owner under concurrent probes. Backend tests now pass 19/19. See qa-api.md and qa-render.md for evidence. Original findings below are retained as an audit record, not unresolved defects.

Privacy QA separately fixed outgoing-history and Git replacement-reference gaps before source publication. See qa-privacy.md and qa-verdict.md. Root browser validation and live Codex reconciliation are in test-report.md; this reviewer did not access accounts.

## Original Findings — Resolved

### R1 — P2: Failed Claude Installation Becomes a False Connected/Waiting State

**Location:** `server/providers.ts:78`, `server/providers.ts:106`, `server/providers.ts:133`; `server/connectors/claude.ts:69`.

Connect enables Claude before installation succeeds. If the settings are malformed, the native status line was changed, or the backup cannot be written, Connect records an error but leaves the provider enabled. The automatic scheduler then runs `refresh`, not `connect`. Claude refresh only reads the inbox; it does not establish whether installation succeeded. With no inbox it reports “Bridge connected”; with an old inbox it reports a connected source. The failed installation therefore disappears from Action Required without ever being repaired. In the waiting case the connection dialog no longer offers Connect, so the user must discover the Disconnect/Connect workaround.

**Synthetic reproducer:** Construct `ProviderService` with an in-memory store from `initialState()`. Stub Claude Connect to throw `ConnectorError('CLAUDE_SETTINGS_UNAVAILABLE', ...)`, and Refresh to return the actual no-inbox result `{ observation: null, waiting: true, message: 'Bridge connected. Continue normal Claude Code use.' }`. Request Connect, await settlement, then request `refresh` with `automatic = true`.

**Observed:** After Connect: `{ enabled: true, status: 'error', errorCode: 'CLAUDE_SETTINGS_UNAVAILABLE' }`. After automatic Refresh: `{ status: 'waiting', errorCode: null, message: 'Bridge connected. Continue normal Claude Code use.' }`. No successful installation occurred.

**Expected:** Preserve a failed-installation action until installation succeeds, or disable collection on setup failure. Reading a cached inbox alone cannot prove a bridge is installed. Add a service-level regression test covering failed Claude Connect followed by a scheduler refresh and an existing old inbox.

### R2 — P2: Cursor Sign-In Cannot Reopen a Lost Session While Persisted Status Is Connected

**Location:** `server/providers.ts:33`, `server/providers.ts:76`; `server/connectors/cursor.ts:123`, `server/connectors/cursor.ts:140`.

Cursor's browser context is process-local and becomes null on server restart or when the user closes its browser. The persisted provider status can still be `connected`. `ProviderService.start` only changes interrupted `connecting` providers; Connect short-circuits every enabled `connected` provider before asking its connector to reconnect. Consequently the visible Open Cursor Sign-In button does nothing in exactly the case where a browser needs reopening. A Refresh followed by Connect works around this because Refresh changes the status to waiting.

**Synthetic reproducer:** Create a fresh service with a fake Cursor connector whose Connect increments a counter. Set its initial provider state to `{ enabled: true, status: 'connected' }`, as persisted after a prior successful read. Call `start(false)` and then `request('cursor', 'connect')`.

**Observed:** `{ accepted: false, message: 'This provider is already connected.' }`; connector Connect call count remains zero; status remains connected.

**Expected:** Explicit Open Cursor Sign-In should ask Cursor's serialized/idempotent connector to reopen or bring its window forward. On restart, mark browser-backed connections waiting until their runtime session is restored. Add tests for restart and browser-close recovery.

### R3 — P2: Stale-Lock Recovery Can Admit Multiple Writers

**Location:** `server/lock.ts:25-34`.

After reading a dead PID, each contender unconditionally removes the lock pathname. Another process may already have removed the stale file and acquired a new lock at that pathname. A slower contender then removes the new owner's lock and acquires its own. This breaks the single-writer guarantee and allows lost state/history updates when competing launches use different ports against the same data root. A shared port may reject one listener, but does not make the root lock correct; its failure cleanup can also remove the remaining lock.

**Synthetic reproducer:** Create a temporary root with `local/server.lock` containing `{ "pid": 2147483647, "port": 0, "token": "synthetic" }`. Run `Promise.allSettled(Array.from({ length: 12 }, () => acquireLock(root, 0)))`. Count fulfilled lock owners before releasing any of them. Repeat with a fresh root. Only generated temporary files are involved, and no server starts.

**Observed:** 30 of 30 rounds admitted multiple owners; the maximum was five successful lock acquisitions in one round.

**Expected:** Exactly one owner per data root. Serialize stale-lock recovery using an exclusive recovery lock and re-read/recheck ownership while holding it, or use another OS-backed exclusive-lock mechanism. Comparing contents and then unconditionally unlinking still leaves a race. Add concurrent stale-recovery tests, including distinct requested ports.

## Validation and Capability Limits

- Initial review baseline: **54 tests passed across 3 files**, before regression fixes. See test-report.md for final counts. Windows sandbox blocked temporary-file rename and native-shell execution; those failures did not reproduce with normal permissions.
- Percent consumption direction, fractional percentages, overage preservation, unknown fields, expired resets, field projection, immutable change history, ETags, Host/Origin/mutation guards, and original Claude stdin/stdout/exit forwarding have relevant passing tests. The three lifecycle/concurrency cases above were absent.
- Cursor is intentionally experimental and user-triggered, needs sign-in, and has no verified automatic polling. Its units and pools still require reconciliation against the actual account's Spending page.
- Claude is a passive Claude Code integration. Its supported status-line fields cannot independently refresh an idle account or prove usage from another product surface. No live native Claude activity was available in this review.
- Codex live reconciliation was not performed by this independent review. Existing prototype claims are not treated as review evidence.
- No style-only findings are reported. Browser layout acceptance remains the production QA lane's responsibility.
