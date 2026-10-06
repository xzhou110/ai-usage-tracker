# Consolidated QA Verdict

Date: October 5, 2026. Product: XuSeak AI Usage Tracker at `D:/Meaningful/AI/ai-usage-tracker`.

## Release Assessment

The reviewed build is ready for a private local handoff with explicit provider-coverage limits, subject to the release-closeout checks below. There are **no remaining confirmed application blockers or must-fix functional defects** in the consolidated reports. Both confirmed publication-gate defects are fixed and independently rechecked. This is not a claim of verified automatic collection across all three providers.

The critic reviewed `qa-api.md`, `qa-render.md`, `qa-static.md`, `review-findings.md`, `qa-privacy.md`, and the PRD. No real account data, credentials, native settings, or private runtime storage was inspected for this verdict.

## Evidence and Finding Dispositions

- The parent agent reports the final full suite at **71/71 passing tests** and a successful final production build after replacement-ref hardening. Earlier counts describe earlier scoped runs.
- API and rendering reviewers independently reproduced and verified the fixes for failed Claude setup being reported as connected, Cursor reopening after restart/browser closure, and concurrent stale-lock takeover. Independent lock stress admitted exactly one owner per generated data root.
- The first P1 publication-history gap was fixed: private files and binaries in outgoing ancestor commits are now checked even after deletion from the final tree. The independent second skeptic then found a replacement-ref bypass: local `git replace` mappings could substitute clean data during inspection. That fix now disables replacements both in the privacy gate's Git subprocesses and in the chained global scanner. Its independently authored original reproducer now rejects the unsafe original; **7/7 privacy-gate regressions pass**, including ancestor and binary-blob replacement cases and exact push-input/argument/environment forwarding. The full suite should be rerun after these final hook changes.
- The parent agent reports browser verification of all work surfaces at 360 px without horizontal overflow, Light/Dark persistence, action dismissal/reopening, and settings conflicts retaining the draft and supporting reapplication. The action-tab keyboard issue in the earlier static report was fixed and checked in the browser.
- Synthetic rendering independently verified unknowns, expired resets, overage, separate pools/spending, currency conversion, source attribution, and daylight-saving ambiguity. No timers manufacture renewed allowance.
- API tests verified Host/Origin protection, static-file containment, strict mutation guards, safe errors, body-size handling, ETag conflicts, and revision-only SSE. Privacy review found quota-only projections, ignored runtime storage, no app telemetry, and no runtime dependency on legacy software-specific project folders.

## Provider Coverage and Conditional User Steps

| Provider | Supported Release Claim | Remaining User Step and Why |
|---|---|---|
| Codex | The parent agent reconciled the live app's percentage, window duration, and reset timestamps against the official desktop quota read. Automatic collection uses the installed account without a model turn. | No additional sign-in is required while that installed account remains authenticated. An upgraded seat is not treated as proof of unlimited allowance; the provider's reported state remains authoritative. |
| Claude | Passive Claude Code bridge; quota projection and reversible integration pass synthetic tests. The parent installed the bridge through the UI successfully; it is waiting for a native event. Real native-event reconciliation remains pending. | Continue ordinary Claude Code use. Claude must emit the event from the user's authenticated native session; the tracker cannot independently refresh an idle account and should not create a paid turn for validation. |
| Cursor | Experimental dedicated-browser connection with explicit quota-source and unit caveats. The parent requested its sign-in window. Personal account reconciliation and automatic collection are not verified. | Authenticate in the dedicated Cursor window, then Refresh Cursor and compare with the official Spending screen. Only the user can complete authentication/challenges; that comparison is required before claiming the undocumented endpoint's units/pools are verified for this account. |

These conditions are connection/reconciliation requirements, not fabricated zero readings and not reasons to ask the user to approve their requested project again. Until satisfied, waiting, unavailable, and experimental labels must remain visible. A claim that all three apps now refresh automatically would exceed the evidence and the PRD's acceptance criterion A2.

## Release Closeout

1. Complete: final full suite 71/71 after replacement-ref hardening; production build passed.
2. Complete by parent: exact staged and outgoing source passed project privacy and global secret gates. Initial commit 9d64590 was pushed successfully to the private repository. The critic's account-access scope remains read-only synthetic QA.
3. Complete: STATE.md, PROJECT.md, workspace index, and finding dispositions now reflect local availability, repository, and pending provider reconciliations.
4. Launcher validated on an isolated empty instance with health HTTP 200; launch configuration points to the production project. The synthetic UI server is stopped. Final browser handoff targets port 8175.

No additional speculative features, account-plan inference, billing changes, real account data exports, or paid validation turns are required for this handoff.
