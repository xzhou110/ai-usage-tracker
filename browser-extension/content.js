let reading = false;
async function syncCursorQuota() {
  if (reading) return { ok: false, message: 'A reading is already in progress.' };
  if (location.origin !== 'https://cursor.com' || !(location.pathname === '/dashboard' || location.pathname.startsWith('/dashboard/'))) return { ok: false, message: 'Open the Cursor dashboard first.' };
  reading = true;
  try {
    const ready = await chrome.runtime.sendMessage({ type: 'can-read' });
    if (!ready?.ok) return ready;
    const data = await readCursorQuota();
    return await chrome.runtime.sendMessage({ type: 'quota', data });
  } catch {
    await chrome.runtime.sendMessage({ type: 'read-failed' }).catch(() => {});
    return { ok: false, message: 'Cursor quota is unavailable. Check that you are signed in to its dashboard; no previous reading was replaced.' };
  } finally { reading = false; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'sync-now') return;
  void syncCursorQuota().then(respond); return true;
});
void syncCursorQuota();
setInterval(() => { void syncCursorQuota(); }, 5 * 60 * 1000);
