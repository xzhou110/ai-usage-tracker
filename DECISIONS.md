# Decisions

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
