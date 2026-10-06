# AI Usage Tracker Integration Research

Researched October 5, 2026. Scope: private Windows dashboard. Documentation and executable help only; no credentials, account identifiers, real quota values, or transcripts were read. These findings establish implementation candidates, not successful account integration.

## Recommendation

1. **Codex Native App Server + Claude Status-Line Bridge + Usage-Page DOM Helper (Recommended).** Codex can poll; Claude can publish quota observations during normal use; a browser extension can read rendered usage cards for Claude/Cursor while the user visits the official quota pages. Coverage and freshness differ and must be visible.
2. **Dedicated Browser Sessions for Every Provider.** More uniform polling, but more session upkeep, undocumented endpoints, challenge handling, and provider-policy uncertainty. The browser does not turn an internal endpoint into a supported API.
3. **Credential Extraction From Existing Apps.** Do not use for this build. It expands credential exposure and account ambiguity, and Claude's current credential guidance conflicts with token-intermediating designs.

Manual observations remain a useful fallback, but must not be presented as automatic coverage.

## Codex: Documented Standalone Path

Run `codex app-server` over stdio. Send `initialize` with a product name/version, await success, send `initialized`, then `account/rateLimits/read`. No conversation or model turn is necessary. Prefer `rateLimitsByLimitId`; use `rateLimits` only for older responses. Every bucket can contain `primary` and `secondary` windows with `usedPercent`, `windowDurationMins`, and `resetsAt` in epoch seconds. Missing windows stay unknown. Optional credit fields describe separate allowances; never redeem reset credits.

The app server owns authentication; the dashboard need not open credential files. Account availability still depends on its installed configuration and sign-in. The dashboard must handle missing login and version differences without falling back to session-log scraping. Use explicit request IDs, timeouts, output size limits, and an allowlist of methods. Ignore unrelated notifications and discard response fields outside quota metadata.

Source: [Official App Server Documentation](https://learn.chatgpt.com/docs/app-server).

Local verification: `codex --version` returned `codex-cli 0.160.0`; `codex app-server --help` confirmed stdio transport and schema generators. Help emitted sandbox-related temporary-directory warnings but exited successfully. No authenticated request was made.

**Spike:** initialize a child process and request quota once, with raw output never printed or persisted. Save only normalized windows under ignored local storage. Reconcile those windows against the intended account's official usage screen before claiming support. Do not launch model inference merely to discover quota.

## Claude: Supported Passive Bridge First

Claude Code's official status-line JSON includes `rate_limits.five_hour` and `rate_limits.seven_day`, each with `used_percentage` and `resets_at` in epoch seconds. These appear for Pro/Max after the first API response; windows may be absent and expired ones are removed.

Configure `statusLine` in user/project settings with `type: "command"` and `command: "node D:/Meaningful/AI/ai-usage-tracker/scripts/claude-statusline-bridge.mjs"` (proposed script path). Optional `padding` remains unchanged. The command receives JSON through stdin. `refreshInterval` reruns the command; it is not proof of a new server quota observation. Source freshness must not advance merely because a timer repeats identical cached input.

A small local status-line script can project only the quota fields to the dashboard's ignored local inbox, preserving the existing visible status line. Drop all other input fields, including transcript paths, session identifiers, working directories, and model details. Do not retain raw stdin. This provides automatic observation during ordinary use; it cannot independently refresh an idle account or guarantee capture of changes made solely through Claude's website.

Source: [Official Status-Line Documentation](https://code.claude.com/docs/en/statusline).

Claude's credential guidance prohibits developers collecting, storing, or intermediating Claude.ai credentials/session tokens and directs end-user sign-in through native flows. This makes a token-reading OAuth collector unsuitable as the recommended design. A private browser profile avoids copying tokens into application JSON, but policy support for automated browser quota polling is still not established by these docs.

Source: [Official Authentication and Credential Guidance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use).

Native interactive terminal surfaces are another possible route, but terminal scraping is less stable than structured status-line input and needs a real Windows terminal feasibility test. Reference: [Official Interactive Commands](https://code.claude.com/docs/en/interactive-mode).

**Spike:** test the bridge with synthetic stdin containing quota and deliberately sensitive extra fields; prove only quota survives. Then observe an ordinary user session without generating a paid turn solely for testing. Installation must preserve the user's existing status-line behavior. Do not promise independent polling.

## Claude: Undocumented Browser Candidate

CodexBar documents `GET /api/organizations`, followed by `GET /api/organizations/{orgId}/usage` on `claude.ai`, plus optional extra-usage endpoints. This is evidence of that project's implementation, not an Anthropic API contract. It also documents Cloudflare challenges. A collector should not query conversations or billing identity endpoints. Organization selection must be explicit if ambiguous; identifiers should remain process-local or in ignored local configuration.

Source: [CodexBar Claude Provider Implementation Notes](https://github.com/steipete/CodexBar/blob/main/docs/claude.md).

No browser payload was observed here. Do not freeze field names or timestamp parsing from assumptions. Verify the usage response in the user's selected dedicated session if this route is chosen. Do not automatically retry challenges or export session cookies.

## Cursor: Browser Connector Candidate

Official Cursor documentation identifies the Spending dashboard as the source of pool usage and reset dates; resets follow the billing cycle. Multiple included pools and on-demand charges must remain separate. A public personal-subscription quota API was not established in the documentation reviewed. Agent SDK token/cost totals are not subscription allowance balances.

Sources: [Usage and Limits](https://prod.cursor.com/help/models-and-usage/usage-limits), [SDK Usage Scope](https://cursor.com/docs/sdk/typescript).

CodexBar documents `GET https://cursor.com/api/usage-summary` for included usage, on-demand spending, and billing-cycle dates. Its additional identity, legacy request, and team endpoints are unnecessary for the initial personal modern-plan spike. This endpoint is undocumented by Cursor and may change.

Source: [CodexBar Cursor Provider Notes](https://github.com/steipete/CodexBar/blob/main/docs/cursor.md).

The implementation reads `billingCycleStart`, `billingCycleEnd`, `individualUsage.plan.{used,limit,totalPercentUsed,autoPercentUsed,apiPercentUsed}`, and `individualUsage.onDemand.{used,limit}`. Its currency amounts are cents; percentage fields already use 0–100 units, so `0.36` means 0.36%, not 36%. It also recognizes `individualUsage.overall` and `teamUsage.pooled`; do not silently combine a team pool with a personal allowance. Do not copy its fallback that converts unavailable values to zero, or average separate pool percentages into one headline. Names such as `autoPercentUsed` require reconciliation against the current dashboard's labels.

Source: [CodexBar Usage-Summary Parser](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Cursor/CursorStatusProbe%2BUsageSummary.swift).

**Spike:** launch installed Chrome with a dedicated ignored profile, let the user sign in to Cursor's own page, then perform one same-origin usage-summary request from that browser context. Return only a strict normalized quota projection to Node. Verify units, labels, and dates against Spending before enabling scheduled refresh.

## Usage-Page DOM Helper

Prefer a small browser extension that reads only the rendered quota cards on approved official usage-page paths and sends a normalized observation to localhost. This avoids both token extraction and private endpoint calls. It is an engineering proposal, not a documented provider integration. It still depends on page structure, active login, and what the page renders; no page open means no new observation. Do not call this unattended polling.

Use narrow host permissions and an explicit page-path guard, no cookies permission, no request interception, and no broad page-body capture. Only collect recognized quota-card labels, numeric measurements, and reset text. Ambiguous relative reset times must remain unknown unless the page supplies a verifiable date/time and timezone. DOM fixtures can validate parsers, but the real page must establish selectors, units, and labels. A login page, challenge, or unrecognized layout emits a connection action and never overwrites previous readings with zero.

Authenticate the extension-to-localhost write with a local pairing capability; validate sender origin plus payload schema and provider identity. An origin header alone is not a secret. Keep pairing material out of page DOM, logs, source control, and page scripts. Expose no general scraping endpoint. Explain installation to the user because browsers intentionally require their approval for a local extension and only they can complete account sign-in.

## Dedicated Browser Profile Alternative

This is an engineering proposal, not verified provider support. Use a separate profile per provider under ignored `local/browser-profiles/`; never attach to the user's normal profile or copy its databases. Installed Chrome avoids a browser download. Browser-managed login keeps password entry and session cookies within the provider/browser flow, but the profile still contains sensitive session material and must never enter backups to Git.

Keep fetches on an exact provider origin and an endpoint allowlist, with bounded responses and schema validation. Do not expose a generic URL proxy, browser debugging port, cookies, or Playwright storage state to the frontend. Authentication, CAPTCHA, or consent prompts become a visible reconnect action; no challenge bypass. A persistent profile can lock if opened twice, so serialize provider operations and close cleanly. Headless behavior, session expiry, and unattended restarts require actual testing.

Begin with user-triggered refresh. Establish low-frequency polling only after the provider spike; honor Retry-After and use exponential backoff with jitter. A failed refresh retains the previous observation and timestamp. A reset timestamp passing means awaiting confirmation, not replenished quota.

## Unresolved Acceptance Evidence

- Intended accounts, plan types, and employer-managed status remain unverified.
- No authenticated standalone quota call or browser collection was performed in this research.
- Claude status-line support is documented, but the installed native Claude version and bridge compatibility remain untested.
- Cursor usage-summary schema and current pool labels remain unverified against this user's account.
- Browser session longevity, Windows Chrome automation, challenge behavior, and sleep/resume recovery require real tests.
- The final product must report automatic coverage independently for each provider and preserve honest disconnected, stale, and manual states.
