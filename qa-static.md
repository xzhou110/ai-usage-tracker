# Static SPA and Bundle QA

- Date: October 5, 2026.
- Instance: Real production server at `http://127.0.0.1:8175`.
- Scope: Read-only HTTP checks, built `dist/`, application source, launch paths, and TypeScript validation. No account observations, identifiers, local storage files, credentials, or connection mutations were inspected.
- Result: No confirmed blocking or functional defects in this scope. One minor keyboard accessibility candidate needs browser confirmation.

## Passed Checks

| Check | Observed Evidence |
|---|---|
| Production HTML | `/`, `/history`, `/settings`, and `/dashboard` each returned HTTP 200, `text/html; charset=utf-8`, and `Cache-Control: no-store`. |
| Asset Delivery | `/assets/index-CUug8IeR.js` returned 200 and `text/javascript; charset=utf-8`, 359,010 bytes. `/assets/index-BgIXWCo_.css` returned 200 and `text/css; charset=utf-8`, 32,308 bytes. Both lengths matched disk. |
| HEAD | Both assets returned 200 with zero response-body bytes and the correct Content-Length. |
| Missing Paths | `/assets/missing.js` and `/history/nested` returned 404 JSON. The app uses hash navigation; unrecognized nested paths are not advertised pages. |
| Nested Page Asset Resolution | The served `/history` HTML references exactly two root-relative `/assets/` URLs; both resolve correctly. |
| Response Hardening | HTML sends CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`. |
| CSP Compatibility | No inline script appears in HTML. Theme initialization runs in the same-origin JS module; CSS and quota-width inline styles are permitted by the declared style policy. |
| Production Bundle | No Vite client or HMR references. Exactly one EventSource constructor. Source effect closes the EventSource on cleanup. |
| External Resources | No external script, font, stylesheet, CSS `url()`, or `@import` dependencies. URL literals in vendor JS are schema/namespace identifiers and React error-documentation references, not resource loads. |
| Themes | Built JS contains the renamed `ai-usage-tracker-theme` persistence key. CSS includes light/dark tokens, visible keyboard focus, and reduced-motion handling. Persistence and actual rendering remain the root agent's browser checks. |
| Responsive Structure | Source uses minmax/min-width safeguards, mobile single-column layouts, scroll-contained history, native modal dialog, associated form labels, and a main-content skip link. Pixel overflow remains the root agent's browser check. |
| Branding and Paths | HTML, app text, package name, launch configuration, and launcher use AI Usage Tracker / ai-usage-tracker. Scoped scan found no dependency on `claude_projects`, `cursor_projects`, or `codex_projects` in app/runtime code, production bundle, launcher configuration, or principal docs. |
| TypeScript | `npm run check` completed successfully (`tsc --noEmit`, exit 0). |

## Unverified Minor Candidate

### Action Tabs Do Not Implement the Declared Keyboard Pattern

- Severity: P3 accessibility; source-confirmed omission, browser behavior not independently exercised in this lane.
- Location: `app/pages.tsx`, `ActionsPage` tab controls.
- Reproduction: Open the synthetic instance's Action Required page, focus the Open tab, then press ArrowRight, ArrowLeft, Home, and End.
- Expected: The declared `role="tablist"` / `role="tab"` control should use the standard tab keyboard behavior: arrow-key focus/selection and one tab stop in the tablist.
- Observed Source: Both controls are ordinary tab-focusable buttons; no `onKeyDown` or roving `tabIndex` is present. Mouse and Tab/Enter operation remain available.
- Suggested Fix: Implement keyboard navigation and roving tabIndex, or use ordinary buttons without tab-widget roles.
- Handoff: Root agent was asked to verify this behavior in its browser pass before classifying it as confirmed.

## Reproduction Commands

Run from the project folder in PowerShell:

```powershell
npm run check
Invoke-WebRequest -Uri 'http://127.0.0.1:8175/history' -UseBasicParsing
Invoke-WebRequest -Uri 'http://127.0.0.1:8175/assets/missing.js' -UseBasicParsing -SkipHttpErrorCheck
Get-ChildItem dist/assets -File | ForEach-Object {
  Invoke-WebRequest -Method Head -Uri ('http://127.0.0.1:8175/assets/' + $_.Name) -UseBasicParsing
}
rg -l 'claude_projects|cursor_projects|codex_projects|@vite/client' app dist server shared scripts tools index.html package.json README.md PROJECT.md PRD.md .codex
```

Asset filenames and sizes record the build present at inspection and may change after subsequent fixes.
