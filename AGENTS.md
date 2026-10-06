# AI Usage Tracker

Read PROJECT.md and PRD.md first. This project lives directly under D:/Meaningful/AI and must not depend on legacy software-specific project folders.

## Privacy
- Never read or print local/ or private/ data during agent work. Automated application code can read its own quota storage and its dedicated browser profile; agent diagnostics must print only validation flags and counts.
- Never read native credential files, conversations, source repositories, or session transcripts for quota collection.
- Keep real quota observations, account identifiers, browser profiles, screenshots with real account data, and status-line backup configuration under ignored local/ or out/.
- No paid inference, purchases, reset redemptions, billing changes, or telemetry.
- Use synthetic fixtures for tests and documentation.

## Implementation
- Codex: installed app-server account/rateLimits/read, only initialization + quota methods; discard unrelated fields.
- Claude: supported rate_limits status-line input; capture only quota fields; preserve existing status line.
- Cursor: explicitly connected dedicated browser session; only quota information; mark experimental until live reconciliation.
- Never infer zero usage or refreshed allowance from missing data or an expired timestamp.
- Bind to 127.0.0.1; verify Host, Origin, and mutation header; JSON writes atomic with ETag concurrency protection.

## Validation
- Documentation/text/minor styling: read-back/diff or inspect the affected screen; no new tests or QA agents.
- Small features/isolated bugs: relevant tests and the affected workflow, with type-check/build when applicable. Add a regression test only when it protects meaningful behavior.
- Major updates, shared architecture changes, app completion, and release milestones: full relevant suite, production build, main user journeys, independent QA, and clean-checkout verification.
- Security, authentication, permissions, payments, privacy, and data migration/loss: deeper targeted tests and independent review regardless of patch size; broaden if impact crosses the app.
- Stop once relevant checks pass. Repeat or expand only for new changes, failures, or unresolved risks. Cheap existing suites do not automatically trigger a full QA sweep.
- Keep privacy/secret publication gates enabled. Report actual checks and material gaps; distinguish fixtures from live connector validation. Never start model turns just to test quota.
