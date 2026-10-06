# XuSeak AI Usage Tracker Design

Date: October 5, 2026. Target: private Windows browser dashboard. The first screen answers three questions: what remains, when it resets, and whether the reading is current.

## Layout and Navigation

- Header: compact XuSeak wordmark, AI Usage Tracker title, work-surface links **Overview**, **History**, and **Action Required** with its open count. Right side: labelled **Light / Dark** switch and a profile icon with an accessible **Settings** label; its menu links to a Settings page.
- Overview introduction: **Your AI Allowances**, a short local-storage note, and **Refresh All**. No composite percentage across apps. A concise status sentence explains coverage, for example "One connected source; two need setup."
- Primary row: three equal provider cards, in Claude / Codex / Cursor order. Cards grow with returned windows rather than dropping secondary pools. At desktop widths, the card grid occupies the main visual focus.
- Below: **Upcoming Resets**, a chronological list with a slim timeline rule, provider/window labels, precise local reset time, timezone, and countdown. Adjacent compact **Action Required** summary links to the full work surface. Unknown reset times appear separately as **Reset Time Unknown**, never sorted as imminent.
- Footer: **Private on This PC** and currently selected timezone. Keep account emails, identifiers, and developer diagnostics off the dashboard.

## Provider Card

Each card contains provider name and simple letter mark; connection/source badge; freshness text; all returned quota windows; and **Refresh**, **Connect** or **Manage Connection**, and **Official Usage** actions as appropriate.

For each window:

1. Source-native window/pool label; for example **5-Hour Window** only when verified.
2. Large **68% Remaining**, smaller **32% Used**, and a progress bar representing *used* quota with an explicit accessible name. The bar's meaning never flips between cards. For unknown percentages use a neutral empty track marked **Unknown**, not a zero-width measured bar.
3. Source-native amount and unit when supplied. Keep on-demand spending separate from included allowances; no dollar-to-quota conversion.
4. **Resets In 2h 14m** and an exact date/time beneath. Once elapsed: **Reset Passed · Awaiting Confirmation**. Retain the last measured value, muted; do not animate to 100% remaining.

Badge vocabulary separates collection mode from health: **Automatic**, **During Claude Use**, or **Experimental**, plus **Current**, **Stale**, **Disconnected**, **Error**, or **Awaiting Confirmation**. A provider can be both Automatic and Stale. A failed refresh preserves the last successful reading and its original observation time. Show progress only on the provider being refreshed; other cards remain interactive.

## Honest Empty and Connection States

The first launch contains the three named providers and no fabricated usage, history, or reset dates. Empty cards say **No Reading Yet** with their specific next step. Do not display plans until supplied by verified metadata or the user.

Connection setup uses a small dialog or dedicated panel with **What Happens**, **Why It Is Needed**, and one primary action:

| Provider | User-Facing Explanation | Main Action and Result |
|---|---|---|
| Codex | "Read allowances through your installed Codex CLI. It uses the account already signed in there and does not run a model request." | **Connect Codex** requests quota; missing installation/sign-in produces a clear next step and retry. |
| Claude | "Send quota readings from Claude Code's supported status line during normal use. This cannot refresh an idle account or independently check Claude's website." | **Set Up Claude Bridge** shows the specific settings change and preserves existing status-line behavior. Until a genuine event arrives, show **Waiting for Claude Use**. If user action is needed, explain that Claude must produce its first quota event and the tracker cannot manufacture it. |
| Cursor | "Use the extension in your normal signed-in browser. Pair it to this PC and keep the dashboard tab open for quota updates. Compare the first reading with Spending." | **Connection Details** explains installation and exposes **Generate Pairing Code**, **Open Cursor Dashboard**, and **Revoke Browser Access**, including before the first reading. **Sync Now** lives in the extension popup; Refresh All does not claim to refresh a closed browser. Successful parsing alone does not claim reconciliation. |

Keep the precise automation limitation beside each connector after setup. Cursor credentials remain in the normal browser; only projected quota reaches this local tracker. Sleeping/closed dashboard tabs stop updates. There is no manual observation form in this release; disconnected or unsupported sources stay explicit.

## History and Action Required

**Usage History:** provider and window filters; observation table with observed time, used/remaining, reset, source, and freshness. Add a simple chart only when sufficient real observations exist. Break lines at reset boundaries, gaps, or changed windows. Empty state: **No Observations Yet**. Do not infer a usage rate or estimated exhaustion date from sparse data.

**Action Required:** tabs **Open** and **History**. Each row explains the issue, its provider/window, last observed time, and a concrete action such as **Reconnect**, **Refresh**, or **Open Official Usage**. Approaching-limit notices name the configurable threshold as a warning preference. **Dismiss** moves a row into History with a timestamp; **Reopen** restores it. A dismissed row does not mark its provider healthy or erase underlying data. A new occurrence may create a new action without rewriting the old history.

**Settings:** connection management, timezone, warning threshold, and concise storage/retention information. Keep backend paths, port configuration, and diagnostic payloads out of normal flows.

## Visual System

- A quiet warm-neutral canvas, crisp bordered cards, generous spacing, and an indigo accent. Flat hierarchy; no gradients, decorative charts, or giant empty hero.
- Font: local system stack (`Segoe UI`, system-ui, sans-serif), 14–16px body; 28–32px page heading; 28px remaining values with tabular numerals; 12–13px metadata. Title Case labels, sentence-case explanatory copy.
- Light: background `#F6F7FB`, surface `#FFFFFF`, primary text `#172033`, muted text `#56647A`, border `#DCE2ED`, accent `#4338CA`.
- Dark: background `#101521`, surface `#192131`, primary text `#F1F4FA`, muted text `#AEBBD0`, border `#344157`, accent `#A5B4FC`.
- Status: neutral for unknown, blue/indigo for current, amber for approaching a user threshold/stale, red for exhausted/error. Always pair color with text and an icon; never imply that a larger allowance makes one provider universally better.
- Card padding 22–24px, 14–16px radius, 16–20px grid gap. Visible focus rings, actual button/link semantics, reduced-motion support, and accessible progress values. Contrast-check final rendered token combinations.

## Responsive and Interaction Rules

Use a centered 1440px maximum content width. Three provider columns on wide screens; two columns at medium widths; one below roughly 760px. Do not reorder providers dynamically. Navigation wraps or becomes a horizontally scrollable labelled row without page overflow. Narrow screens place reset/action sections below cards; history rows become stacked labelled records. Touch targets are at least 44px. Dialogs trap focus, support Escape, and return focus to their trigger. Countdown ticks do not trigger screen-reader live announcements; refresh success/failure uses a polite status region. Format all dates using the selected IANA timezone, and keep stored instants in UTC.

## Design Acceptance

- Verify real production pages in both themes at desktop and 390px widths with no horizontal overflow.
- Check keyboard navigation, dialog focus, visible field errors, and labelled progress bars.
- Demonstrate disconnected, waiting-for-event, fresh, stale, failed-refresh, and passed-reset states using isolated test fixtures; never install fixtures as real initial account data.
- Confirm multiple windows fit each provider card and exact reset timestamps remain legible.
- Confirm Dismiss/Reopen persists and changing the theme does not change data.
