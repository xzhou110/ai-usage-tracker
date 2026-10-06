---
name: ai-usage-tracker
summary: Private dashboard for Claude, Codex, and Cursor quota usage and reset times
status: active
live: http://127.0.0.1:8175
repo: https://github.com/xzhou110/ai-usage-tracker
updated: 2026-10-05
category: ai-tooling
phase: usable-local-release
next: Receive Claude quota and complete Cursor sign-in and reconciliation
visibility: private
---

# AI Usage Tracker

## 1. Summary
XuSeak AI Usage Tracker brings Claude, Codex, and Cursor allowances into one private Windows dashboard, preserving each provider's quota windows, units, and reset times. The production app includes usage history, reset countdowns, connection notices, and settings. Codex is live and reconciled; Claude awaits a native quota event; Cursor awaits user sign-in and remains experimental.

## 2. Key Facts
| Item | Value |
|---|---|
| Kind | Personal usage dashboard |
| Stack | React + TypeScript + Vite, local Node 24 server, Zod, Playwright Core for Cursor |
| Local Path | `D:/Meaningful/AI/ai-usage-tracker` |
| Run | npm run build, then npm start; loopback port 8175 |
| Deploy | Localhost only; source backup excludes all runtime data |
| Data | Quota metadata only; local and excluded from Git |
| Started | 2026-10-05 |

## 3. Key Things to Know
- A chat tool reading usage is not proof of a standalone app integration.
- Unknown or expired observations must never appear as zero usage or confirmed resets.
- Do not read conversations, prompts, employer repositories, or unrelated account data.
- No account identifiers, credentials, or real usage observations belong in tracked files.

## 4. Details
### How It Works
Provider adapters normalize quota observations into separate windows. A local server stores observations; the dashboard displays current usage, reset countdowns, freshness, history, and connection actions. Codex uses its installed app-server, Claude uses a passive status-line bridge, and Cursor uses an experimental dedicated browser connection.

### How to Work on It
Read PRD.md and STATE.md first. Prove data access before promising automatic collection. Production-build QA and live account reconciliation are required before completion.

### Current State and Open Items
Production UI and synthetic integration tests passed. Codex percentages, duration, and reset instants matched the desktop account source after Refresh. Claude's bridge is installed; Cursor's sign-in browser is open. Neither has a live quota reading yet. See test-report.md and STATE.md for precise coverage.

### Change Highlights
- 2026-10-05 — Created project home and initial PRD before application code.
- 2026-10-05 — Built and validated the private dashboard; renamed all code and documentation to AI Usage Tracker in D:/Meaningful/AI/ai-usage-tracker. Enabled quota connections and prepared private source backup without runtime data.

## 5. Pointers
- [PRD.md](PRD.md) — Product requirements and acceptance criteria.
- [DECISIONS.md](DECISIONS.md) — Scope and architecture decisions.
- [STATE.md](STATE.md) — Current phase and unresolved questions.
- [RUN_LOG.md](RUN_LOG.md) — Work performed and verification.
