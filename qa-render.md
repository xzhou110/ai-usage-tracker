# Independent Recovery and Rendering QA

- Date: October 5, 2026.
- Scope: Second-skeptic verification of R1–R3 from `review-findings.md`; synthetic React rendering and display semantics.
- Evidence: An independently authored runner at ignored `out/qa-independent.mjs` imports the actual provider service, Claude connector, lock implementation, Cursor normalizer, React components, and display helpers. It passed **8 of 8** checks, exit code 0.
- Isolation: All generated settings, inboxes, stores, and locks are beneath a fresh `out/independent-qa-*` folder. No existing `local/`, `private/`, native account files, or real account observations were read. Neither production port 8175 nor synthetic dashboard port 8176 was started, stopped, or mutated. Vite was used only as an in-process module transformer with no listening server.

## Recovery Findings Rechecked

| Original Finding | Independent Reproduction and Observed Result | Disposition |
|---|---|---|
| R1: Failed Claude setup becomes falsely connected on refresh | Real `ClaudeConnector` received malformed generated native settings and a valid old synthetic inbox. Connect produced `CLAUDE_SETTINGS_UNAVAILABLE`; a subsequent automatic service Refresh produced `CLAUDE_BRIDGE_NOT_CONNECTED`, remained in error, imported no observation, and left settings unchanged. | Fixed for the reproduced failure path. |
| R2: Cursor cannot reconnect after restart | A new service began with persisted enabled/connected Cursor and a prior synthetic observation. Startup changed it to waiting; explicit Connect invoked the fake browser connector exactly once and retained the observation. | Fixed. |
| R2: Cursor cannot reopen a closed browser in the same process | After startup, the synthetic service was set to enabled/connected while its fake connector had no runtime session. Explicit Connect was accepted, invoked the connector once, and preserved previous quota. Initial source review caught the remaining short-circuit; the reviewer applied the additional fix before this independent runner executed. | Fixed by the additional Cursor-specific short-circuit exception. |
| R3: Concurrent stale-lock takeover admits several writers | Forty fresh generated roots each had a dead synthetic PID lock. Sixteen concurrent acquisitions used distinct requested ports per round. Exactly one owner succeeded every round; all owners were released afterward. No server or real lock was involved. | Fixed for the reproduced race: maximum concurrent owners 1 across 640 attempts. |

## Rendering Evidence

The tests rendered the actual `ProviderCard` and `ResetTimeline` React components to static HTML using synthetic values. They did not merely inspect the existing unit-test assertions.

| Case | Expected and Observed |
|---|---|
| Unknown Usage | Unknown quota and reset remain explicitly unknown; no numeric zero percentage and no determinate progressbar are emitted. |
| Expired Reset | Card says Reset Passed / Awaiting Confirmation; timeline places the reset under Awaiting Confirmation and emits no future countdown for that window. |
| Over-Limit Usage | Synthetic 135% usage remains visible in text; progressbar is bounded at 100 and remaining allowance is floored at zero. No renewed allowance is manufactured. |
| Multiple Windows | A synthetic Cursor payload yields three separate quota windows and one separate spending block. Plan, overall, team scope, and overlap caveats remain distinct. |
| Currency Units | Synthetic cents convert once to USD; plan/overall/team used-and-limit labels and separate on-demand spending render the expected decimal dollar values. No `NaN` or `undefined` appears. |
| Source Attribution | Cursor Usage Page and Experimental labels remain visible. Claude Code Status Line and Installed Codex Account source labels match the normalized source identifiers. |
| Native Count Units | A synthetic requests allowance renders its used/limit values with the requests unit. |
| Timezones | The repeated Los Angeles fall DST hour renders distinct PDT/PST labels. Equal UTC instants expressed with different offsets produce the same expired/awaiting-confirmation decision. |
| History Merge | Refreshing the newest page deduplicates matching IDs, preserves previously loaded older observations, and orders newest first. History table source review confirms original observed timestamps, reported reset timestamps, source labels, and spend-versus-quota units are used. |

## Limits and Not Applicable

- This lane did not verify pixel layout, browser console behavior, keyboard focus, or theme persistence; the root agent owns production-browser verification.
- Real provider units and live account reconciliation remain separate acceptance checks. Synthetic rendering proves conversion and labeling behavior, not the validity of an undocumented provider endpoint's future contract.
- PDF generation, exports, print variants, image thumbnails, and downloadable reports are **not applicable**: this product exposes no such features.
- No new confirmed bug remains in this lane after the additional R2 fix.

## Reproduction

From the project folder, run `node out/qa-independent.mjs`. The runner creates fresh synthetic files under ignored `out/`, exercises recovery and React rendering, prints only pass/fail evidence, and exits 0 when all checks pass. It does not access provider accounts or launch a browser.
