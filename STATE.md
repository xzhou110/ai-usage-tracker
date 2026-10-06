# State

- Phase: Usable local release; live coverage is partial.
- Added: Native Windows sidebar and local membership/price editing. Sidebar startup confirmed; direct native minimize/restore, pinning, and owned-server shutdown interactions remain unverified because native UI automation is unavailable in this session.
- Project: D:/Meaningful/AI/ai-usage-tracker. No dependency on legacy software-specific project folders.
- App: http://127.0.0.1:8175, bound to loopback only.
- Complete: PRD before code, research, design, contract, three connectors, responsive dashboard, reset timeline, history, Action Required with dismiss/reopen, conflict-safe settings, and production QA.
- Codex: Automatic quota reads work. Production readings matched the native desktop source for percentage, window duration, and exact reset instant. No inference call used.
- Claude: Reversible quota-only bridge installed through the app. Awaiting a supported rate_limits event from normal Claude Code use. Live values remain unverified; idle Claude cannot be refreshed independently.
- Cursor: Dedicated local Chrome profile opened successfully. User must sign in and select Refresh Cursor. Connector remains experimental and user-triggered; live units/pools and automatic polling remain unverified.
- Verification: See test-report.md and qa-verdict.md. Browser tested desktop/mobile, both themes, history filters, notice lifecycle, keyboard tabs, and concurrent settings edits.
- Privacy: Only source, synthetic tests, and documentation enter GitHub. Runtime storage, browser profiles, native configuration backup, screenshots, and account metadata remain ignored locally.
- Open User Steps: Normal Claude activity and Cursor sign-in. No new paid request required for testing.
