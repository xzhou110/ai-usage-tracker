# Cursor Browser Connection

This local Chrome/Edge extension replaces the automated sign-in browser that Google and Cloudflare rejected. Sign in normally; the extension reads quota only after pairing. It does not log in, solve challenges, read DOM fields, access the cookies API, or copy login credentials.

## Install and Pair

Installation is a user action because it grants a new browser extension access to Cursor's dashboard. Review the code and permissions before loading it. Native Chrome/Edge installation is not controlled by the current Codex browser tools.

1. In your normal browser, open Extensions, turn on **Developer Mode**, then choose **Load Unpacked**. This allows your private extension to be loaded directly from its local source, without publishing it to a store. You must approve this browser access yourself.
2. Select `D:/Meaningful/AI/ai-usage-tracker/browser-extension`. Keep this folder in place; the browser loads these source files from here.
3. Open the official [Cursor Dashboard](https://cursor.com/dashboard?tab=usage), sign in normally, and reload the page once. The reload activates the newly installed content script on that tab. Only you can complete your account verification.
4. In AI Usage Tracker, open Cursor **Connection Details**, then **Generate Pairing Code**. Copy that code into the extension popup's **Pairing Code** field and click **Pair With Tracker**. The one-use code authorizes this browser extension to send quota to this PC; it expires after ten minutes. Never paste it into a website or chat.
5. While the Cursor dashboard tab is selected, click **Sync Now** in the extension. The first reading should appear in the tracker. Compare the displayed pools, amounts, percentages, and billing reset with Cursor's Spending page. Until that comparison succeeds, the connection remains experimental.

## Operation and Permissions

- Collection occurs at page load and every five minutes while a signed-in dashboard tab remains open. Browser sleeping/throttling, closing the tab, or quitting the browser pauses collection. The tracker retains the last observation with its original timestamp and marks it stale according to your settings.
- The content script runs only on `https://cursor.com/dashboard*` and checks the exact dashboard path before reading. It requests the fixed `https://cursor.com/api/usage-summary` endpoint using the browser's normal session, then discards all fields except numeric quota pools and billing-cycle timestamps before sending any data to the extension worker.
- The worker sends only to `http://127.0.0.1:8175/api/cursor-browser`. Chrome's localhost host permission covers all ports, but the code hardcodes port 8175 and accepts no caller-selected URL. No remote telemetry or quota upload exists.
- The `storage` permission holds the local tracker token in the browser's local extension storage, restricted to trusted extension contexts. It does not use synced storage. The tracker stores only a token hash, bound to the extension Origin, under ignored `local/` storage.
- **Revoke Browser Access** in the tracker works even before the first reading. It immediately rejects further uploads and cancels pending pairing codes. After the first rejected upload, the extension forgets its token and stops further reads. Remove the extension in the browser to stop its script immediately.
- Source responses have a 1 MB transport limit and projected local updates have a 32 KB transport limit. These bound untrusted messages, not the user's usage/history. Readings delayed or clock-shifted by more than one minute are rejected; Sync Now obtains a new reading.

## Current Verification Limit

Synthetic tests cover pairing, Origin/Host rejection, schema/size boundaries, projection privacy, source timestamps, revocation, and worker sender checks. Actual installation, extension-to-localhost connectivity, and live Cursor quota reconciliation require the owner's normal browser and remain unverified until performed there. The endpoint is undocumented and may change.
