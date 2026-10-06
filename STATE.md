# State

- Current Window UX: Auto-Hide stays in the toolbar; the duplicate Minimize button is removed. The sidebar becomes transparent and passes clicks through at the upper-right corner without minimizing, retaining its taskbar icon. Corner hover or taskbar activation reveals it. Native title-bar Minimize suspends hover reveal. Eight focused desktop tests and the production build pass. Actual Windows animation/taskbar/hover interaction remains unverified by the available browser-only tools.
- Cursor Sign-In: Both Google and email human verification failed in the automated browser. Owner confirmed normal-browser sign-in works. Replaced the automated connection with a quota-only browser extension and local pairing. Installation in the owner's browser, real extension-Origin/localhost connectivity, and live reading reconciliation remain pending; do not call Cursor connected until that succeeds.

- Phase: Usable local release; live coverage is partial.
- Added: Native Windows sidebar and local membership/price editing. Sidebar startup confirmed; direct native minimize/restore, pinning, and owned-server shutdown interactions remain unverified because native UI automation is unavailable in this session.
- Project: D:/Meaningful/AI/ai-usage-tracker. No dependency on legacy software-specific project folders.
- App: http://127.0.0.1:8175, bound to loopback only.
- Complete: PRD before code, research, design, contract, three connectors, responsive dashboard, reset timeline, history, Action Required with dismiss/reopen, conflict-safe settings, and production QA.
- Codex: Automatic quota reads work. Production readings matched the native desktop source for percentage, window duration, and exact reset instant. No inference call used.
- Claude: Reversible quota-only bridge installed through the app. Awaiting a supported rate_limits event from normal Claude Code use. Live values remain unverified; idle Claude cannot be refreshed independently.
- Cursor: browser-extension/ is ready for installation after approval. One-use codes expire in ten minutes; stored token hashes bind to the extension Origin. Reads occur every five minutes with an open dashboard tab. Refresh All does not invent a browser reading; use Sync Now in the extension. Revoke Browser Access works before the first reading and preserves history.
- Verification: See test-report.md and qa-verdict.md. Browser tested desktop/mobile, both themes, history filters, notice lifecycle, keyboard tabs, and concurrent settings edits.
- Privacy: Only source, synthetic tests, and documentation enter GitHub. Runtime storage, browser profiles, native configuration backup, screenshots, and account metadata remain ignored locally.
- Open User Steps: Normal Claude activity; approve/install the Cursor extension, pair locally, and compare its first reading with the official Spending page. No new paid request required for testing.
