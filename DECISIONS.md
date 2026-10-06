# Decisions

## 2026-10-05 — Auto-Hide and Cursor Sign-In Guidance
- Owner replaced the independent pin/edge controls with one right-edge auto-hide mode. Hide the native window fully rather than moving its contents onto a neighboring monitor; reveal after a short edge hover without focusing it. A local pointer-position check runs only while enabled and stores no pointer history. Editing and open dialogs hold the window visible; explicit minimization suppresses hover reveal.
- Google documents rejecting automation-controlled browsers: https://support.google.com/accounts/answer/7675428. Cursor's current public sign-in page was inspected and offers Continue with email. Guide the user through that existing option using the same account email. This is not proof that email sign-in or quota collection will work for every account. No security bypass or Google-login automation is added.

## 2026-10-05 — Windows Sidebar
- Use a movable right-edge Electron window with standard taskbar minimize/restore and optional session-only Stay on Top. Preserve the full browser dashboard; do not reserve desktop space.
- Reuse the local server and existing quota semantics. Keep the renderer sandboxed, deny permissions/downloads, validate IPC senders, and restrict external links to known provider pages and the full local dashboard. Follow Electron's official security guidance: https://www.electronjs.org/docs/latest/tutorial/security.
- Membership and actual billed price are editable locally and explicitly labelled as user entries. Do not invent plan names, prices, unlimited usage, or quotas after a seat upgrade.
- Minimize keeps the host and collection alive. Close stops only a server started by this desktop instance. A separately started server is never terminated.
- Verify with existing automated tests plus targeted storage/desktop boundary tests, production browser flows, independent security and UX review, and a clean source checkout. Native control interaction remains an explicit verification gap when native UI tools are unavailable.

## 2026-10-05 — Proportional Verification
- Owner approved matching test effort to each request's scope and risk. Routine text, styling, and isolated behavior changes should not trigger the full release process.
- Use focused checks for small asks; full tests, production build, user journeys, independent QA, and clean-checkout verification for major updates and app completion/release milestones.
- Escalate security, privacy, authentication, permissions, payments, and data migration/loss to deeper targeted testing and independent review regardless of patch size. Keep publication privacy/secret gates enabled.
- Stop once relevant checks pass; repeat or broaden only when new changes, failures, or unresolved risks justify it. Report evidence and gaps without claiming unperformed checks.

## 2026-10-05 — Full Build With Feasibility First
- Tier: Full Build under the multi-agent-orchestrator build skill.
- Draft the PRD before implementation as requested.
- Recommend local hosting; wait for the user's answer before making that architecture binding.
- Prove standalone connectors before promising automatic coverage. Manual entry alone does not satisfy an implied automatic tracker without disclosure and agreement.
- No real account data persisted during intake. No agents spawned before the build-brief gate.
- Available agents use the session's inherited model; do not claim the skill's unavailable Claude model aliases were used.

## 2026-10-05 — Local Hosting Confirmed
- User chose Private Windows Dashboard. Original instruction authorizes PRD followed by build; proceed with research and implementation preparation without another redundant permission round.
- Account selection and manual fallback tolerance are factual product clarifications, still pending; do not access dependent account data before they are resolved.
- Researcher dispatched with only public documentation and safe executable discovery in scope.

## 2026-10-05 — Software-Neutral Workspace
- User explicitly directed all new work to D:/Meaningful/AI; legacy claude_projects and cursor_projects will go away.
- AI Usage Tracker lives at D:/Meaningful/AI/ai-usage-tracker. All dependencies, launch configurations, test fixtures, and documentation stay in this project; no runtime paths point to legacy project folders.

## 2026-10-05 — Narrow Provider Connections
- Codex uses the native app-server without reading its credential files. Claude uses supported quota-only status-line input. Cursor uses an explicitly opened dedicated browser profile, with its undocumented quota endpoint labelled experimental.
- No automatic collection occurs before each provider is connected. Missing sign-in or source events are setup states, never zero usage.
- No manual quota entry was selected; removed it from the draft design instead of silently substituting it for tracking.
- History pagination is a transport choice, not a retention cap. Usage and reset windows remain separate; no cross-provider score.
- Native Windows TLS trust is used for npm via NODE_USE_SYSTEM_CA=1. Certificate verification remains enabled.
