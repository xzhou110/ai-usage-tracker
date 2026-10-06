# AI Usage Tracker

Read PROJECT.md and PRD.md first. This project lives directly under D:/Meaningful/AI and must not depend on legacy software-specific project folders.

## Automatic GitHub Backup
- Owner authorization (October 5, 2026): after completing future project changes, verify proportionately, commit with a clear message, and push to the private xzhou110/ai-usage-tracker repository without asking again. Do not publish unfinished work or unrelated changes.
- Keep project privacy and global secret-scanning hooks enabled for every commit/push. Exclude credentials, tokens, cookies, browser profiles, real account/usage data, screenshots, local/, private/, out/, and .env files. If a gate fails, stop publication and report the file/rule without exposing its contents; never bypass it.
- Confirm the push succeeded. This is source backup only; the app remains private on localhost and is not deployed to GitHub Pages.

## Privacy
- Never read or print local/ or private/ data during agent work. Automated application code can read its own quota storage and its dedicated browser profile; agent diagnostics must print only validation flags and counts.
- Never read native credential files, conversations, source repositories, or session transcripts for quota collection.
- Keep real quota observations, account identifiers, browser profiles, screenshots with real account data, and status-line backup configuration under ignored local/ or out/.
- No paid inference, purchases, reset redemptions, billing changes, or telemetry.
- Use synthetic fixtures for tests and documentation.

## Implementation
- Codex: installed app-server account/rateLimits/read, only initialization + quota methods; discard unrelated fields.
- Claude: supported rate_limits status-line input; capture only quota fields; preserve existing status line.
- Cursor: use only the paired extension in the owner's normal browser. Automated sign-in was rejected by Google and Cloudflare; never retry that path, copy cookies, or bypass challenges. The extension must project quota fields before crossing the browser boundary. Installation and live reconciliation are required before claiming support; opening the official dashboard alone is not a connection.
- Never infer zero usage or refreshed allowance from missing data or an expired timestamp.
- Bind to 127.0.0.1; verify Host, Origin, and mutation header; JSON writes atomic with ETag concurrency protection.

## Validation
- Documentation/text/minor styling: read-back/diff or inspect the affected screen; no new tests or QA agents.
- Small features/isolated bugs: relevant tests and the affected workflow, with type-check/build when applicable. Add a regression test only when it protects meaningful behavior.
- Major updates, shared architecture changes, app completion, and release milestones: full relevant suite, production build, main user journeys, independent QA, and clean-checkout verification.
- Security, authentication, permissions, payments, privacy, and data migration/loss: deeper targeted tests and independent review regardless of patch size; broaden if impact crosses the app.
- Stop once relevant checks pass. Repeat or expand only for new changes, failures, or unresolved risks. Cheap existing suites do not automatically trigger a full QA sweep.
- Keep privacy/secret publication gates enabled. Report actual checks and material gaps; distinguish fixtures from live connector validation. Never start model turns just to test quota.
