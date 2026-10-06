# AI Usage Tracker

A private Windows dashboard for Claude, Codex, and Cursor quota usage and reset times. Built under the XuSeak brand. All account usage stays on your PC.

## Open the App

On this PC, press the **Windows key**, type **AI Usage Tracker**, and open it. The Start shortcut launches the sidebar and starts its local server when needed. You can also double-click **AI Usage Tracker** on your desktop. Neither route needs Codex or a terminal. Opening it again brings the existing app forward.

The app stays in `D:/Meaningful/AI/ai-usage-tracker`; these shortcuts point there. If Start search has not indexed it yet, use the desktop shortcut or double-click **Start-AI-Usage-Sidebar.vbs** in the project folder. To keep a launcher on your taskbar after closing the app, right-click the Start result and choose **Pin to Taskbar** (Windows may put this under **More**). Pinning is an optional personal Windows action; no automatic startup or pinning is configured.

## Set Up a Fresh Checkout

With Node 24 installed, run `npm install`, then `npm run build`, then `npm start` from this folder. Installation fetches the app's dependencies; the build produces the browser interface; start serves it on [127.0.0.1:8175](http://127.0.0.1:8175). The server binds only to your machine.

For the Windows sidebar, run `npm run setup:desktop` once to download the official Electron runtime, then double-click **Start-AI-Usage-Sidebar.vbs** (no terminal window) or **Start-AI-Usage-Tracker.cmd**. `npm run sidebar` does the same from a terminal. On a Windows machine with TLS inspection, set `$env:NODE_USE_SYSTEM_CA='1'` before installation so Node uses Windows' trusted certificates. Setup is already complete on this PC; these commands are for a fresh checkout.

After setup, double-click **scripts/install-windows-shortcuts.vbs** to create or repair current-user Start and Desktop shortcuts. It needs no administrator access, verifies each target, and confirms that the app is available in Start and on the Desktop. Run it after moving or checking out the project elsewhere; it refuses to overwrite a same-named shortcut pointing at another location, so remove that old shortcut first if you intentionally moved the app. These shortcuts launch the desktop executable directly without a terminal window. The installer uses the same Windows Script Host as the existing folder launcher; it does not change PowerShell execution policy.

Turn **Auto-Hide** On using the button in the original toolbar position. The app docks at the current monitor's usable upper-right corner. Move away and it disappears in place after a short delay, without a minimize animation. While invisible it passes clicks through and releases keyboard focus. Hover at that corner's right edge and it reappears above ordinary windows without stealing keyboard focus. The rest of the right edge does not reveal it. Its usage-bars icon remains in the Windows taskbar: select it to bring the app back. Open dialogs and active editing keep it visible. Turning the toggle Off restores a normal movable window. The mode lasts for the current session. The duplicate toolbar Minimize button is removed; the standard title-bar Minimize still suspends hover reveal until you restore the app. Opening the launcher again also brings it back.

**Open Full Dashboard** opens history, settings, and connection details in the browser. Closing the sidebar stops a server it started; a separately started `npm start` server keeps running. Browser previews cannot control desktop positioning. The **ai-usage-tracker** launch configuration remains available for browser-only use.

Click a provider's membership row to enter your actual plan, subscription price, currency, and monthly/yearly billing period. These entries remain local and are labelled **Your Entry**. Blank means unknown; 0 means free. Plan names and prices are not automatically detected in this release. They do not change billing or estimate quota. The sidebar shows every provider-reported quota window and reset time; unknown and expired readings remain explicit.

## Connect Your Apps

| App | Collection | Setup and Limits |
|---|---|---|
| Codex | Installed Codex app-server, automatic polling | Click Connect Codex to use the account already signed in to your local Codex CLI. No model request is generated. If it is not signed in, sign in through Codex itself; the tracker cannot choose your account or complete authentication for you. |
| Claude | Supported Claude Code status-line input | Click Connect Claude to install a reversible local quota bridge. Your existing status line is preserved. Use Claude Code normally; its next supported quota event supplies an observation. The tracker cannot refresh Claude while it is idle, and it never starts a paid model request just to check usage. |
| Cursor | Paired normal-browser extension, experimental | Install the local extension using [the setup guide](browser-extension/README.md), generate a pairing code in Cursor Connection Details, and use Sync Now from the signed-in Cursor dashboard. Only you can approve extension access and complete sign-in. Updates run every five minutes while the tab stays open; sleeping or closed tabs stop them. The previous automated Google/email login path is removed. Installation and real pool/unit reconciliation remain pending. |

No app can guarantee access to account quota before its provider supplies data. Disconnected, waiting, stale, and unverified states are shown explicitly. This release does not substitute manually entered or sample percentages.

## Understand the Numbers

Each window or pool is independent. Consumed percentage is shown alongside remaining percentage; on-demand spending is separate. A known reset shows the provider's exact timestamp and a countdown in your selected timezone. When that timestamp passes, the reading awaits confirmation until the provider reports a current window. The dashboard never assumes an expired window is now empty.

History contains collected observations, not reconstructed past usage. Claude's repeated cached status-line input does not advance the observation time. Settings let you choose the timezone, stale threshold, and warning percentage; warning thresholds do not limit your provider usage.

## Privacy and Source Backup

`local/` holds observations, membership details, settings, action history, native status-line backup configuration, and dedicated browser/desktop profiles. `private/` and `out/` are also excluded from Git. No conversations, prompts, employer repositories, native credential files, or analytics are collected. Only source code, synthetic tests, and documentation may be committed.

Public source: [AI Usage Tracker Repository](https://github.com/xzhou110/ai-usage-tracker). Only source and documentation are public; the app runs locally and account data stays on your PC. The project and global hooks inspect staged content and original outgoing Git objects, including earlier commits. After cloning for development, run `git config core.hooksPath .githooks` to activate the project gate; the user's global secret scanner must also be installed. This is development setup, not a step needed to use the already-running dashboard.

Disconnect stops collection and preserves existing usage history. Claude restoration leaves later user edits intact instead of overwriting them. Browser profiles and quota history remain local until you explicitly remove them yourself.

## Development and Verification

Choose checks by scope and risk using AGENTS.md. Documentation/text/minor styling receive focused checks; small behavior changes receive relevant tests and workflow verification. Major updates and app completion/release milestones receive the full production QA gate. Security, privacy, authentication, payments, and data-loss risks require deeper targeted tests and independent review even when small. Stop once relevant checks pass; privacy and secret gates always remain enabled.

- `npm test` runs synthetic adapter and isolated server tests without querying your accounts.
- `npm run build` checks TypeScript and creates the production build.
- `npm start` runs the production server; this is the instance used for final browser verification.

See [PRD.md](PRD.md), [api-contract.md](api-contract.md), [tech-plan.md](tech-plan.md), and [STATE.md](STATE.md) for scope and current validation status.
