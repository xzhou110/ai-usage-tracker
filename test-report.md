# AI Usage Tracker Validation

## Normal-Browser Cursor Connection and Upper-Right Corner Follow-Up

85 tests across seven files and TypeScript/production build passed. The first sandboxed run could not create Windows Git/process/temp fixtures; the normal-permission run passed. Added actual extension-script VM tests plus real-loopback synthetic integration tests for one-use/expiring pairing, exact Host and extension-Origin boundaries, strict quota projection, malformed/oversized/delayed readings, hashed tokens, preservation, restart timestamps, revocation before first read, queued-read rejection, and worker token clearing. Updated native doubles confirm top alignment, corner-only reveal, ordinary-edge rejection, monitor offsets, minimize suppression, and no focus theft.

Two focused independent authentication/privacy and regression reviewers found revocation and error-reporting gaps; all were fixed and rechecked. The production browser preview confirms the button remains in the toolbar, Cursor setup/revocation controls fit a 400px viewport, and no console errors occur. The updated native app started successfully.

Live gaps: the extension has not been installed in the owner's normal browser, so actual Chrome/Edge Origin/localhost behavior and real Cursor quota reconciliation remain unverified. The owner confirmed normal-browser sign-in works. Native pointer/hover behavior cannot be exercised with this session's browser-only tools. Historical email-sign-in guidance below is superseded; it was tried by the owner and failed.

The staged source also passed a clean-folder npm ci (zero audit findings), all 85 tests, and the production build with matching asset hashes. The temporary checkout was removed after verification. Runtime quota/profile data was excluded from the export.

## Auto-Hide Follow-Up

47 focused desktop/connector tests and TypeScript/production build passed. Auto-hide tests cover pointer exit/edge dwell, reveal without focus, edit holds, explicit minimization, display removal while hidden, release, taskbar/launcher reopening, and timer/listener cleanup using injected native-window doubles. Cursor status tests verify Google rejection guidance does not leak URL parameters. Inspected Cursor's public sign-in screen and confirmed Continue with email exists; no account email or credentials were entered. Native hover behavior and successful email authentication are not established by these tests.

## Window Controls Follow-Up

The owner reported Stay on Top had no apparent effect in the native app. Fixed missing active feedback and reload state mismatch by reading native state and listening for changes; pinning now also raises the window and reapplies after restore. Added the independent right-edge toggle. Six focused desktop tests passed, covering pin readback/failure, restore, docking across offset displays, resizing, release, cleanup, and invalid commands. TypeScript and production build passed; updated native host startup confirmed. These tests use injected native-window doubles and do not prove real Windows z-order; owner confirmation requested separately.

## Windows Sidebar Update

- 75 synthetic tests passed across five files; TypeScript and production build passed. Added exact desktop URL/geometry checks, membership validation/concurrency tests, and a legacy-state test preserving a nonempty quota observation and history.
- Production synthetic instance on 8176: narrow 400px layout inspected in Light/Dark; theme and membership persisted across reload; zero monthly price and annual price stayed distinct from unknown; a concurrent update returned 412 while preserving the draft, and reapply succeeded. Full Dashboard navigation passed. No unexpected browser console errors before the intentional 412.
- Independent security review found no must-fix boundary issue. UX review found a pending-save dismissal race, fixed by disabling Cancel/Close/Escape while saving. Legacy history test strengthened and passed.
- Actual Windows sidebar startup reported ready and started the real local server. Native minimize/restore, pinning, and ownership shutdown interactions are NOT verified: native UI tools are unavailable in this session. Browser checks do not establish those native behaviors.
- Membership plan and price are user-entered; automatic detection is not claimed. Existing Claude/Cursor coverage limitations below still apply.
- Clean source verification: exported the staged Git tree to an isolated folder with no ignored state; `npm ci` reported zero vulnerabilities, all 75 tests passed, and the production build produced the same asset hashes as the working project. Temporary browser tabs and the synthetic server were closed afterward. Real sidebar preview saved only under ignored `out/`.

Tested October 5, 2026 on the Windows production app at http://127.0.0.1:8175. Account values, IDs, and configuration contents are intentionally omitted from this tracked report.

## Result

Usable private local release with partial live provider coverage. Codex is validated end to end. Claude installation and Cursor browser launch succeeded; their actual quota values still need a native event and user sign-in respectively. Missing values never appear as zero.

## Automated and Independent QA

- All 71 tests in four files pass. Synthetic tests cover connector projection/units/freshness, original Claude status-line forwarding, HTTP/storage concurrency, actions, display helpers, and source privacy gates. Clean-checkout evidence is recorded in RUN_LOG.md.
- TypeScript and Vite production build pass.
- API: health HTTP 200; Host/Origin/mutation guards; malformed JSON 400; invalid schema 422; oversize body 413; stale ETag 412; concurrent settings writes 200 plus 412; traversal and junction escape blocked; SSE revision and heartbeat delivered.
- Static: HTML/routes/assets and MIME types correct; missing assets 404; no HMR, external font, analytics, or unexpected remote resource.
- Lifecycle: failed Claude setup stays an error despite an old inbox; Cursor reconnect works after restart/browser closure; repeated concurrent stale-lock probes admit one writer.
- Privacy: staged files and every outgoing commit tree exclude runtime/private paths and unreviewed binaries, including files deleted at the tip. Original Git objects are inspected despite replacement refs. Global scanner receives original push refs/arguments and the same original-object protection.

## Browser Evidence

Root operated the production UI through the in-app browser. Edge cases used a separate synthetic fixture server, stopped afterward.

- Dashboard title is AI Usage Tracker; three provider cards and correct sources.
- Codex Connect/Refresh works. A fresh reading exactly matched native desktop percentage, duration, and reset instant. Active usage can change between reads, so reconciliation follows Refresh.
- Claude Connect installs its reversible bridge and shows Waiting for Reading. Cursor Connect opens its dedicated browser and shows Waiting for Reading.
- Multiple quotas stay separate; remaining/used percentages, overage, expired-reset confirmation, and separate USD spending display correctly.
- Desktop and 360-pixel mobile layouts have no horizontal overflow; history remains readable.
- Light/Dark selection persists on reload; provider filtering returns expected history rows.
- Dismiss moves a notice to History; Reopen restores it. Arrow keys and Home move tab focus/selection with one tab stop.
- Settings persist. A second-tab edit causes a conflict, preserves unsaved input, shows saved preferences, and Reapply My Edits saves the intended values.
- Browser console produced no unexpected warnings/errors during final checks.

## Acceptance Mapping

- PRD A1, A3–A10: Implemented and validated for the local release with provider capabilities disclosed. The renamed Windows launcher served an isolated empty instance with health HTTP 200; the registered configuration points to the real project server.
- PRD A2: Passed for Codex; pending real Claude event and Cursor account reconciliation. Cursor automatic polling is disabled.
- Naming: folder, package, title, launcher, launch configuration, protocol client, docs, and workspace index use AI Usage Tracker / ai-usage-tracker. Old project folders are absent; runtime has no legacy-root dependency.

## Detailed Reports

See qa-api.md, qa-static.md, qa-render.md, qa-privacy.md, qa-verdict.md, and review-findings.md. Source backup contains no real readings or screenshots.
