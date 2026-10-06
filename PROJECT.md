---
name: ai-usage-tracker
summary: Private dashboard for Claude, Codex, and Cursor quota usage and reset times
status: active
live: http://127.0.0.1:8175
repo: https://github.com/xzhou110/ai-usage-tracker
updated: 2026-10-05
category: ai-tooling
phase: usable-local-release
next: Receive Claude quota and install/reconcile the Cursor browser extension
visibility: private
---

# AI Usage Tracker

## 1. Summary
XuSeak AI Usage Tracker brings Claude, Codex, and Cursor allowances into one private Windows dashboard, preserving each provider's quota windows, units, and reset times. The production app includes usage history, reset countdowns, connection notices, and settings. Codex is live and reconciled; Claude awaits a native quota event; the replacement Cursor browser extension awaits user installation and live reconciliation.

## 2. Key Facts
| Item | Value |
|---|---|
| Kind | Personal usage dashboard |
| Stack | React + TypeScript + Vite, local Node 24 server, Zod |
| Windows Host | Electron sidebar; launch Start-AI-Usage-Sidebar.vbs after setup |
| Local Path | `D:/Meaningful/AI/ai-usage-tracker` |
| Run | npm run build, then npm start; loopback port 8175 |
| Deploy | Localhost only; source backup excludes all runtime data |
| Data | Quota metadata only; local and excluded from Git |
| Started | 2026-10-05 |

## 3. Key Things to Know
- Windows sidebar: Start-AI-Usage-Sidebar.vbs opens a native window with one Auto-Hide toggle. It hides after the pointer leaves, reveals on upper-right corner hover without taking focus, and stays visible for editing/dialogs. This replaces the earlier two pin/edge controls. Membership name, price, currency, and period are user-entered local metadata, never inferred from quota.
- Cursor: Owner confirmed normal-browser sign-in works. The local extension in browser-extension/ reads quota from that signed-in dashboard and pairs to this PC via a one-use code. Updates run every five minutes while the tab is open; sleeping/closed tabs stop them. Install and reconcile before claiming live support. Do not retry automated sign-in, copy cookies, or bypass human verification.
- The Auto-Hide button stays in its original toolbar position. The window docks at the usable upper-right corner, automatically minimizes on pointer exit, and reveals from that corner's right-edge hotspot (3 by 48 DIP). Its usage-bars taskbar icon remains available for recovery. Explicit Minimize suspends hover reveal. The browser preview shows the control disabled.
- The desktop host uses Electron with a sandboxed renderer and restricted IPC. Browser-only usage remains supported. Closing the sidebar stops only a server it started; minimizing keeps collection running.
- A chat tool reading usage is not proof of a standalone app integration.
- Unknown or expired observations must never appear as zero usage or confirmed resets.
- Do not read conversations, prompts, employer repositories, or unrelated account data.
- No account identifiers, credentials, or real usage observations belong in tracked files.

## 4. Details
### How It Works
Provider adapters normalize quota observations into separate windows. A local server stores observations; the dashboard displays current usage, reset countdowns, freshness, history, and connection actions. Codex uses its installed app-server, Claude uses a passive status-line bridge, and Cursor uses a paired extension in the user's normal browser. Only quota projections cross the browser boundary; the tracker stores a hash of the extension token, never browser credentials. Pair/reading routes alone accept a bound extension Origin; other routes keep their same-origin guards.

### How to Work on It
Read PRD.md and STATE.md first. Prove data access before promising automatic collection. Follow the proportional verification tiers in AGENTS.md: focused checks for small asks, full production QA for major updates and app completion/release milestones, and deeper targeted review for high-risk changes. Live reconciliation is required before claiming a connector is verified; unrelated edits do not require repeating it.

### Current State and Open Items
Production UI and synthetic integration tests passed. Codex percentages, duration, and reset instants matched the desktop account source after Refresh. Claude's bridge is installed. Cursor's automated sign-in failed and was replaced; extension installation and real quota reconciliation remain pending. Neither Claude nor Cursor has a live quota reading yet. See test-report.md and STATE.md for precise coverage.

### Change Highlights
- 2026-10-05 — Created project home and initial PRD before application code.
- 2026-10-05 — Built and validated the private dashboard; renamed all code and documentation to AI Usage Tracker in D:/Meaningful/AI/ai-usage-tracker. Enabled quota connections and prepared private source backup without runtime data.

## 5. Pointers
- [PRD.md](PRD.md) — Product requirements and acceptance criteria.
- [DECISIONS.md](DECISIONS.md) — Scope and architecture decisions.
- [STATE.md](STATE.md) — Current phase and unresolved questions.
- [RUN_LOG.md](RUN_LOG.md) — Work performed and verification.
