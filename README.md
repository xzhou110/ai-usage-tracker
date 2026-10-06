# AI Usage Tracker

A private Windows dashboard for Claude, Codex, and Cursor quota usage and reset times. Built under the XuSeak brand. All account usage stays on your PC.

## Run Locally

With Node 24 installed, run `npm install`, then `npm run build`, then `npm start` from this folder. Installation fetches the app's dependencies; the build produces the browser interface; start serves it on [127.0.0.1:8175](http://127.0.0.1:8175). The server binds only to your machine.

After the first build, double-click **Start-AI-Usage-Tracker.cmd**, or use the **ai-usage-tracker** launch configuration. Keep the server running while using the dashboard; closing it stops collection.

## Connect Your Apps

| App | Collection | Setup and Limits |
|---|---|---|
| Codex | Installed Codex app-server, automatic polling | Click Connect Codex to use the account already signed in to your local Codex CLI. No model request is generated. If it is not signed in, sign in through Codex itself; the tracker cannot choose your account or complete authentication for you. |
| Claude | Supported Claude Code status-line input | Click Connect Claude to install a reversible local quota bridge. Your existing status line is preserved. Use Claude Code normally; its next supported quota event supplies an observation. The tracker cannot refresh Claude while it is idle, and it never starts a paid model request just to check usage. |
| Cursor | Dedicated local Chrome session, experimental | Click Connect Cursor, then sign in to Cursor in that browser and return to Refresh. Only you can complete account authentication or challenges. A separate browser profile keeps this connection apart from your normal browsing. The internal usage endpoint can change; live unit/pool reconciliation is required before claiming verified coverage. |

No app can guarantee access to account quota before its provider supplies data. Disconnected, waiting, stale, and unverified states are shown explicitly. This release does not substitute manually entered or sample percentages.

## Understand the Numbers

Each window or pool is independent. Consumed percentage is shown alongside remaining percentage; on-demand spending is separate. A known reset shows the provider's exact timestamp and a countdown in your selected timezone. When that timestamp passes, the reading awaits confirmation until the provider reports a current window. The dashboard never assumes an expired window is now empty.

History contains collected observations, not reconstructed past usage. Claude's repeated cached status-line input does not advance the observation time. Settings let you choose the timezone, stale threshold, and warning percentage; warning thresholds do not limit your provider usage.

## Privacy and Source Backup

`local/` holds observations, settings, action history, native status-line backup configuration, and the dedicated Cursor browser profile. `private/` and `out/` are also excluded from Git. No conversations, prompts, employer repositories, native credential files, or analytics are collected. Only source code, synthetic tests, and documentation may be committed.

Source backup: [Private AI Usage Tracker Repository](https://github.com/xzhou110/ai-usage-tracker). The project and global hooks inspect staged content and original outgoing Git objects, including earlier commits. After cloning for development, run `git config core.hooksPath .githooks` to activate the project gate; the user's global secret scanner must also be installed. This is development setup, not a step needed to use the already-running dashboard.

Disconnect stops collection and preserves existing usage history. Claude restoration leaves later user edits intact instead of overwriting them. Browser profiles and quota history remain local until you explicitly remove them yourself.

## Development and Verification

Choose checks by scope and risk using AGENTS.md. Documentation/text/minor styling receive focused checks; small behavior changes receive relevant tests and workflow verification. Major updates and app completion/release milestones receive the full production QA gate. Security, privacy, authentication, payments, and data-loss risks require deeper targeted tests and independent review even when small. Stop once relevant checks pass; privacy and secret gates always remain enabled.

- `npm test` runs synthetic adapter and isolated server tests without querying your accounts.
- `npm run build` checks TypeScript and creates the production build.
- `npm start` runs the production server; this is the instance used for final browser verification.

See [PRD.md](PRD.md), [api-contract.md](api-contract.md), [tech-plan.md](tech-plan.md), and [STATE.md](STATE.md) for scope and current validation status.
