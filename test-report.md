# AI Usage Tracker Validation

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
