# Data and Privacy QA

Date: October 5, 2026. Scope: source review, isolated synthetic fixtures, production health at port 8175, and the explicitly synthetic instance at port 8176. No native credentials/settings, real account APIs, private runtime files, conversations, or real quota observations were inspected.

## Confirmed Finding and Fix

### P1 — Push Gate Ignored Private Files in Outgoing History

Before the fix, `.githooks/pre-push` invoked `privacy-gate.mjs --tracked`, which inspected the current Git index. A clean index and clean final commit did not establish that earlier commits being pushed were safe. An earlier commit containing a private quota file remained publishable after that file was removed. The chained global scanner inspects commit history for its configured secret/employer rules; it does not independently prohibit this project's runtime paths.

Reproduced in a new temporary Git repository containing synthetic data only:

1. Stage a harmless source fixture: the gate exits 0.
2. Add `local/quota.json` containing a synthetic counter: the gate exits 1.
3. Construct an isolated commit containing that path, then a child commit removing it, using Git plumbing. The final index and tree contain only source.
4. Run the original `node privacy-gate.mjs --tracked`: exit 0, although `git log --all --name-only` still contains the prohibited path.
5. Stage a synthetic NUL-containing binary as a separate positive control: exit 1.

Expected: pre-push rejects every outgoing history that contains a prohibited path or unreviewed binary, regardless of the current index and final tree.

Fix: the push hook now passes Git's push ref input to `--push`. That mode inspects every outgoing commit tree for every updated ref, including removed files in ancestor commits. New branches and unavailable remote objects receive a complete reachable-history scan. Ref deletions are skipped, malformed ref input fails closed, and duplicate blobs are scanned once. Blob bytes are streamed and errors never print their content. The hook then supplies the original ref input and hook arguments to the global secret scanner.

After-fix evidence: the isolated ancestor-file regression now exits 1; safe source exits 0; outgoing old binaries are rejected; multiple refs and ref deletion behave correctly. A synthetic global hook receives both original ref lines and both original arguments. No real push or project-index mutation was performed by this QA work.

Files changed under the parent agent's explicit authorization: `scripts/privacy-gate.mjs`, `.githooks/pre-push`, and `scripts/privacy-gate.test.ts`.

## Passed Checks

| Check | Evidence |
|---|---|
| Synthetic connector, display, and privacy-gate regressions | 50/50 tests pass in 3 files using normal Windows permissions. |
| Type checking | `node node_modules/typescript/bin/tsc --noEmit` exits 0. |
| Ignored private/runtime paths | `git check-ignore` matches `local/`, `private/`, `out/`, `node_modules/`, `dist/`, `.env`, and `.env.production` probes. |
| Hook activation and chaining | Repository `core.hooksPath` is `.githooks`; both project hooks require the global scanner and hold if it is unavailable. Push stdin/argument preservation is regression-tested. |
| Real server health | `http://127.0.0.1:8175/api/health` returns HTTP 200. No real quota endpoint was read. |
| Synthetic server shape | Port 8176 `/api/status` returns HTTP 200, three providers, six fixture windows, explicit synthetic messages, source names, and collection timestamps. No sensitive key names appear. |
| Synthetic numeric traceability | The returned Claude/Codex quota figures and Cursor on-demand amount match the fixture generator. Source tests prove percentage direction, unknowns, overage, cents conversion, and spending separation. |
| Frontend privacy controls | Production HTML has `connect-src 'self'`; API responses have `Cache-Control: no-store`. Source uses local API fetches and includes no telemetry integration. |
| Claude projection | Tests prove session IDs, transcript paths, unrelated fields, and context usage are excluded from persisted quota projections. Native status-line forwarding uses isolated test fixtures. |
| Codex transport and projection | Tests prove only initialize/initialized/account-rate-limits methods are sent; unrelated notifications/native error content do not reach observations. Unknown bucket labels are neutralized. |
| Cursor projection and isolation | Source uses a dedicated ignored `local/browser-profiles/cursor` profile, fixed quota endpoint, same-origin credentials, no redirects, and an allowlist before data crosses the browser boundary. Mocked boundary tests exclude identities and reject unsafe numeric fields/challenges. |
| Legacy-folder independence | Source search across app, server, shared types, tools, scripts, and hooks found no `claude_projects`, `cursor_projects`, or `codex_projects` runtime paths. |

## Reproduction Commands

From the project root, with normal Windows permissions:

```powershell
& 'C:\Program Files\nodejs\node.exe' node_modules/vitest/vitest.mjs run scripts/privacy-gate.test.ts server/connectors/connectors.test.ts app/display.test.ts
& 'C:\Program Files\nodejs\node.exe' node_modules/typescript/bin/tsc --noEmit
```

The first command runs only synthetic temporary-repository, connector, and display checks. The second checks the application's configured TypeScript files. Sandboxed execution initially produced temporary-file rename/shell-launch failures; the same tests all passed under normal Windows permissions, so those sandbox failures are not reported as application bugs.

## Limits of This Review

- The project had no tracked files when the initial `git ls-files` check ran; final staged/committed contents still need the release gate. This report does not claim a completed source publication.
- Real provider/account reconciliation and end-user browser network behavior were outside this delegated privacy review.
- Agent/native settings were not read; this review does not certify external deny-read configuration.
- No remaining independently confirmed privacy defect was found in the reviewed scope after the push-gate fix. Independent refutation and the parent agent's final release checks remain applicable.
