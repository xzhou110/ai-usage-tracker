# XuSeak AI Usage Tracker — PRD

Status: Private Windows dashboard confirmed; automatic collection is the target. Date: October 5, 2026.

## Problem and Intended Outcome
Switching among Claude, Codex, and Cursor requires checking different usage screens and remembering different reset schedules. The user needs one reliable answer to: how much quota remains in each app, which limit is binding, and when that allowance becomes available again?

## Target User
Initially xzhou on Windows. Personal subscriptions are the provisional scope. If an employer account is included, its quota metadata stays exclusively on the machine; no employer content is collected or published.

## Recommended Product Shape
A private local dashboard with three provider cards, a reset timeline, usage history, and Action Required for disconnected or stale sources. React and TypeScript provide the UI; a loopback-only Node server stores plain JSON locally. Brand: XuSeak. Product name: AI Usage Tracker. Project root: D:/Meaningful/AI/ai-usage-tracker. No runtime dependency on legacy software-specific project folders.

Local hosting is preferred because account integrations may need local authentication and the data does not need a public backend. A hosted or multi-user product requires a separate authentication and security design and should not be assumed.

## Core Requirements
Updated October 5: Keep the Auto-Hide toggle in its original toolbar position. Dock the window at the monitor's usable upper-right corner and reveal it from that corner's right-edge hotspot, rather than anywhere along the edge.

Cursor replacement: Owner confirmed sign-in works in a normal browser. Build a local browser extension that reads only quota from the already signed-in dashboard and sends it to the tracker after explicit pairing. Keep browser credentials in the browser. Poll every five minutes while the dashboard tab is open, with a manual Sync option. Browser sleep/closure makes the reading stale; never imply continuous coverage or live verification before real reconciliation. Installation requires the owner's permission; no automated login, copied cookies, or challenge bypass.
0. Windows Sidebar: Provide one Auto-Hide toggle in the original toolbar, replacing the separate pin/edge controls. When enabled, keep the sidebar at the current monitor's usable upper-right corner, hide after the pointer leaves, and reveal on deliberate upper-right corner hover without stealing keyboard focus. Keep it open for editing and dialogs. Turning the mode off restores a normal window. Standard minimize suppresses hover reveal until restored. Handle display changes and retain access through the launcher. Collection continues while hidden/minimized. Include all three apps, membership name, actual subscription price and billing period, quota windows, and reset countdowns. Retain the full dashboard. Unknown values stay unknown; prices never imply quota. Closing the sidebar stops only a server it started, never a separately running tracker.
1. Show Claude, Codex, and Cursor independently, including every quota window or pool returned by a verified source.
2. Show used and remaining percentage when known, source-native amount and unit when available, reset date/time, and live countdown. Never infer a monetary budget from a percentage.
3. Label each observation with its source, collection time, and freshness. Distinguish Automatic, During Claude Use, Experimental, Disconnected, Stale, and Error states.
4. Prefer automatic read-only collection. Establish and test a standalone data path separately for each provider before promising support. An integration unavailable outside this chat is not an automatic app connector.
5. No manual quota entry in this release: the user requested tracking and has not selected a manual fallback. If a connector needs sign-in or normal native activity, provide a concrete setup action and display unavailable/waiting honestly until it supplies evidence.
6. Show Upcoming Resets sorted by timestamp and rendered in the user's selected timezone, initially America/Los_Angeles. Keep UTC instants in storage. Handle daylight-saving changes and unknown dates.
7. Once a recorded reset time passes, mark that window as awaiting confirmation and request a refresh. Do not manufacture a fresh zero-usage reading or advance an assumed recurring date.
8. Keep a local observation history per provider and quota window. Break chart lines across resets, missing observations, or changed windows. Do not present sample data as the user's usage.
9. Provide Refresh All and per-provider refresh, independent errors, last successful refresh, and reconnect/source links. Use bounded timeouts and backoff; final polling frequency depends on verified provider behavior.
10. Show actionable status: stale data, disconnected sources, exhausted windows, and an adjustable approaching-limit warning. Dismissed actions retain history and can be reopened; warnings are not quota restrictions.
11. Include a labelled Light/Dark switch, responsive layouts, accessible labels and keyboard controls. Navigation contains work surfaces; settings live under the right-side profile/settings control.
12. Store real observations and any integration session material only in ignored local storage. Keep credentials out of the frontend, tracked files, logs, exports, and screenshots used for documentation. Store only quota metadata, never prompts or conversations.

## Provider Semantics and Evidence
### Claude
Claude's official documentation says usage limits are shared across its product surfaces and depend on plan and workload. The collector must use reported windows rather than estimating quota from local token counts. A supported standalone personal-account usage endpoint has not yet been established.
Source: https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work

### Codex
Official documentation directs users to the usage dashboard or CLI status for current allowances and reset times. A standalone prototype successfully called the installed Codex app-server account/rateLimits/read method and validated bucket/window percentages and reset timestamps without printing or saving account data. The app-server must run with the normal user's runtime permissions; the sandboxed prototype timed out. Connection remains an explicit per-provider action in the app, so the user chooses when to use their installed CLI account.
Source: https://learn.chatgpt.com/docs/pricing

### Cursor
Current official documentation describes separate model usage pools on many plans, with monthly resets tied to the billing cycle. Preserve all returned pools, separate included usage from on-demand charges, and use the reported billing reset date. Historical team Admin API documentation does not establish an individual-account API; the old documentation URL redirects and is not an implementation contract.
Source: https://prod.cursor.com/help/models-and-usage/usage-limits

## Non-Goals for the First Release
- Buying credits, redeeming free resets, changing subscriptions, or enabling on-demand billing.
- Estimating provider quota from token counts, request counts, or subscription list prices.
- Reading chats, source code, or employer material.
- A public SaaS, mobile app, external messaging, or background cloud service.
- Claiming equal capabilities or interchangeable quota across providers.

## Acceptance Criteria
- A1: All three providers appear; each shows actual collected data with verification status or an explicit unavailable/waiting state, never invented values.
- A2: Automatic connectors are reconciled against the matching account's official usage surface, with timestamped local test evidence. Any unsupported connector is disclosed as incomplete automatic coverage.
- A3: Multiple simultaneous windows/pools display correctly; percentage direction and units match the provider.
- A4: Countdown tests cover future, expired, unknown, timezone, and daylight-saving cases; expiry alone never marks an account replenished.
- A5: A connection failure affects only that provider and preserves its last successful observation with a stale/error label.
- A6: Saved observations and preferences survive a restart; failed writes and concurrent edits cannot silently overwrite data.
- A7: History distinguishes source observations, resets, missing data, and different window identities.
- A8: Major updates and app completion/release milestones pass the full relevant suite, production build, main user journeys in both themes and narrow layouts, independent QA, and clean-checkout verification with no unresolved must-fix findings. Smaller asks use focused checks from AGENTS.md; high-risk changes receive deeper targeted tests and independent review regardless of size.
- A9: Localhost access protections and Git exclusions are verified; no credentials, account identifiers, employer data, or real quota snapshots enter source control.
- A10: The owner can open the app from a registered launch configuration; connection instructions explain what the user must do, why, and why the app cannot do it for them.

## Success Measures
The user can identify each app's remaining allowance and next known reset without visiting three dashboards. Automatic coverage is measured provider by provider. Reliable freshness and honest unknown states matter more than a superficially complete dashboard.

## Implementation Plan
1. Confirm intended accounts, plan types, and local versus hosted access.
2. Research and prototype read-only standalone quota collection; record actual support for each provider.
3. Refine this PRD from findings, create design and API contracts, and freeze shared types.
4. Build adapters/storage and UI in independent file lanes using specialist agents.
5. Integrate, run production-build tests and adversarial QA, reconcile against live sources, and perform product acceptance.
6. Back up validated source to a private repository after the privacy gate; keep quota data local. Register and open the local app.

## Open Questions
- Resolved: private Windows dashboard.
- Which plans and accounts should be tracked? Are any employer-managed?
- Manual fallback was not selected; keep setup gaps explicit and continue automatic connector feasibility.
