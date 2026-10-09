---
name: ai-usage-tracker
summary: Private dashboard for Claude, Codex, and Cursor quota usage and reset times
status: active
live: none
repo: https://github.com/xzhou110/ai-usage-tracker
updated: 2026-10-08
category: ai-tooling
phase: polishing
next: Reconcile the first Claude Desktop Code reading and the Cursor browser extension
visibility: private
repo_visibility: public
---

# AI Usage Tracker

## 1. Summary
XuSeak AI Usage Tracker brings Claude, Codex, and Cursor allowances into one private Windows dashboard, preserving each provider's quota windows, units, and reset times. The production app includes usage history, reset countdowns, connection notices, and settings. Codex is live and reconciled; the Claude Desktop Code mod is installed and awaits a real quota event; the replacement Cursor browser extension awaits live reconciliation.

## 2. Key Facts
| Item | Value |
|---|---|
| Kind | Personal usage dashboard |
| Stack | React + TypeScript + Vite, local Node 24 server, Zod |
| Windows Host | Electron sidebar; Start search or Desktop shortcut named AI Usage Tracker |
| Local Path | `D:/Meaningful/AI/ai-usage-tracker` |
| Run | npm run build, then npm start; loopback port 8175 |
| Deploy | Localhost only; source backup excludes all runtime data |
| Source Visibility | Public GitHub repository; app/account data remain private and local |
| Data | Quota metadata only; local and excluded from Git |
| Started | 2026-10-05 |

## 3. Key Things to Know
- Command Center treats this as an on-demand local app, not a public live site: live: none prevents expected shutdowns from raising website-outage warnings. Its Start App mapping remains in the workspace .claude/launch.json at port 8175. Closing a sidebar-owned server stops the local address; launch again to restore it. The public GitHub repository hosts source only.
- Automatic source backup is authorized: after each completed, proportionately validated change, commit and push to the public GitHub repository without another confirmation. Privacy/secret hooks remain mandatory; credentials and runtime account data stay local. The visibility: private metadata still describes runtime-data handling, not repository visibility. See AGENTS.md.
- Everyday launch: use AI Usage Tracker in Windows Start or on the Desktop. Shortcuts target this project; scripts/install-windows-shortcuts.vbs recreates them after setup. The VBS launcher remains a folder-based fallback. Launching again reveals the existing instance; no automatic startup is enabled.
- Windows sidebar: Start-AI-Usage-Sidebar.vbs opens a native window with one Auto-Hide toggle. It hides after the pointer leaves, reveals on upper-right corner hover without taking focus, and stays visible for editing/dialogs. This replaces the earlier two pin/edge controls. Membership name, price, currency, and period are user-entered local metadata, never inferred from quota.
- Cursor: Owner confirmed normal-browser sign-in works. The local extension in browser-extension/ reads quota from that signed-in dashboard and pairs to this PC via a one-use code. Updates run every five minutes while the tab is open; sleeping/closed tabs stop them. Install and reconcile before claiming live support. Do not retry automated sign-in, copy cookies, or bypass human verification.
- The Auto-Hide button stays in its original toolbar position; no duplicate toolbar Minimize button. On pointer exit, the window becomes transparent in place and passes clicks through, releasing keyboard focus without minimizing or animating. It reveals from the upper-right corner's right-edge hotspot (3 by 48 DIP) or taskbar activation. Its usage-bars taskbar icon remains available. Native title-bar Minimize suspends hover reveal. The browser preview shows Auto-Hide disabled.
- The desktop host uses Electron with a sandboxed renderer and restricted IPC. Browser-only usage remains supported. Closing the sidebar stops only a server it started; minimizing keeps collection running.
- A chat tool reading usage is not proof of a standalone app integration.
- Claude Desktop Code uses the native mod in claude-plugin/, not the terminal status line. Setup: scripts/install-claude-desktop-bridge.ps1; new local Code sessions load it. It projects only allowance fields to the ordinary guarded localhost receiver. See claude-plugin/README.md for installation, runtime conditions, tests, and remaining live validation.
- Unknown or expired observations must never appear as zero usage or confirmed resets.
- Do not read conversations, prompts, employer repositories, or unrelated account data.
- No account identifiers, credentials, or real usage observations belong in tracked files.

## 4. Details
### How It Works
Provider adapters normalize quota observations into separate windows. A local server stores observations; the dashboard displays current usage, reset countdowns, freshness, history, and connection actions. Codex uses its installed app-server, Claude Desktop Code uses a passive native mod (with the older terminal bridge retained), and Cursor uses a paired extension in the user's normal browser. Only quota projections cross boundaries. Cursor pair/reading routes alone accept a bound extension Origin; the Claude mod uses the existing localhost mutation guard without a new CORS exception.

### How to Work on It
Read PRD.md and STATE.md first. Prove data access before promising automatic collection. Follow the proportional verification tiers in AGENTS.md: focused checks for small asks, full production QA for major updates and app completion/release milestones, and deeper targeted review for high-risk changes. Live reconciliation is required before claiming a connector is verified; unrelated edits do not require repeating it.

### Current State and Open Items
Production UI and synthetic integration tests passed. Codex percentages, duration, and reset instants matched the desktop account source after Refresh. Claude Desktop Code was confirmed as the intended surface; a local mod is installed and the ineffective terminal wrapper restored. Native mod tests, local receiver tests, and independent privacy review passed; an actual Desktop reading and reconciliation remain pending. Background polls no longer extend the manual refresh cooldown. Cursor's automated sign-in failed and was replaced; real extension reconciliation remains pending. See test-report.md and STATE.md for precise coverage.

### Change Highlights
- 2026-10-05 — Created project home and initial PRD before application code.
- 2026-10-05 — Built and validated the private dashboard; renamed all code and documentation to AI Usage Tracker in D:/Meaningful/AI/ai-usage-tracker. Enabled quota connections and prepared private source backup without runtime data.

## 5. Pointers
- [PRD.md](PRD.md) — Product requirements and acceptance criteria.
- [DECISIONS.md](DECISIONS.md) — Scope and architecture decisions.
- [STATE.md](STATE.md) — Current phase and unresolved questions.
- [RUN_LOG.md](RUN_LOG.md) — Work performed and verification.
