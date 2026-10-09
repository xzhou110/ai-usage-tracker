# Claude Desktop Code Connection

This local mod connects **Claude Desktop's local Code tab** to AI Usage Tracker. The older terminal status-line bridge does not run in that interface. Requires Claude Code 2.1.287 or newer; installation and native tests were performed with 2.1.293.

## Everyday Use

After installation, open a **new local Code session** in Claude Desktop. This loads the plugin; you choose when to reopen a session so active work is not interrupted. Continue your normal work with AI Usage Tracker open. No extra paid message is needed for testing.

Claude emits `session.measure` when its reported quota changes. The mod sends only allowance kind, consumed percentage, and reset timestamp to `127.0.0.1:8175`. It retries a captured reading every minute while that session remains open. It never reads prompts, transcripts, credential files, cookies, or account identifiers, and never calls a model. Startup alone does not manufacture a fresh quota reading. Desktop chat, Cowork, cloud Code sessions, and closed sessions are not verified collection surfaces.

The tracker shows the source as **Claude Desktop Code Bridge**. Compare the first reading with Claude's Usage screen. **Refresh** only imports the stored reading; it cannot force Claude to fetch current quota. Cached retries retain the capture time. Missing quota stays unknown. Disconnect Claude in the tracker to reject further uploads; existing history is preserved.

## Install or Repair

Run `./scripts/install-claude-desktop-bridge.ps1` from the project in PowerShell. It locates Claude Desktop's bundled Code runtime, validates the mod, registers this local marketplace, installs `ai-usage-tracker-bridge@ai-usage-tracker-local` for the current user, and selects the Desktop source. It restores the original terminal status line when it still owns that setting; later user edits are preserved. This script is for setup/repair, including after a folder move, not everyday launch.

If Claude is disconnected in the tracker, choose **Connect Claude** after installation. Open a new local Code session to load it. The installed source stays in this project; no browser extension or new sign-in is required. The local selection marker is not proof that Claude loaded the plugin. User or organization settings that disable mods can prevent collection.

To remove the integration, first disconnect Claude in the tracker, then uninstall **AI Usage Tracker Bridge** through Claude's plugin management. Keep the tracker disconnected until reinstalling. This preserves quota history and avoids changing other plugins.

## Method and Verification

Implementation follows Anthropic's [mods reference](https://code.claude.com/docs/en/plugins/mods/reference) and [native test harness](https://code.claude.com/docs/en/plugins/mods/test). The important quality bar is a strict quota projection before transmission, unchanged session behavior, no cached freshness inflation, and no new browser-origin exception.

Run Claude's bundled executable with `plugin validate ./claude-plugin/quota-bridge --strict` and `plugin test ./claude-plugin/quota-bridge`. Native tests cover Desktop events, discarded private fields, missing data, stale startup snapshots, and a never-answering tracker. App tests in `server/claude-desktop.test.ts` cover the real local HTTP receiver, origin/Host/header checks, body bounds, invalid input, cached timestamps, late arrivals, and disconnect. `npm test` excludes native mod tests because only Claude provides their test runtime.

Delivery runs outside Claude's event chain with at most one request outstanding. If the native HTTP request never settles, this instance cannot send again until that request ends or Claude reloads the plugin; Claude itself stays responsive. Installation/native test success is separate from a real Desktop reading and reconciliation.
