const BASE = 'http://127.0.0.1:8175/api/cursor-browser';
const trustedStorage = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const dashboardSender = sender => {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab) return false;
  try { const url = new URL(sender.url); return url.origin === 'https://cursor.com' && (url.pathname === '/dashboard' || url.pathname.startsWith('/dashboard/')); } catch { return false; }
};
const popupSender = sender => sender.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
async function post(route, data, token) {
  const response = await fetch(`${BASE}/${route}`, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    if (response.status === 403) {
      if (token) await chrome.storage.local.remove('token');
      throw new Error('Pair the extension again in the tracker.');
    }
    if (response.status === 422) throw new Error('Cursor returned an unsupported or delayed reading. Sync again; previous data is kept.');
    throw new Error('The tracker could not accept this update. Keep the Windows app open and try Sync Now again.');
  }
  return response.json();
}
async function handle(message, sender) {
  await trustedStorage;
  const fromDashboard = dashboardSender(sender);
  const fromPopup = popupSender(sender);
  if (!fromDashboard && !fromPopup) return { ok: false, message: 'This page cannot use the connection.' };
  if (message?.type === 'pair' && fromPopup) {
    if (!/^[a-f0-9]{32}$/.test(message.code)) return { ok: false, message: 'Paste the 32-character code from the tracker.' };
    const result = await post('pair', { code: message.code });
    if (!/^[a-f0-9]{64}$/.test(result.token)) throw new Error('The tracker returned an invalid pairing response.');
    await chrome.storage.local.set({ token: result.token, message: 'Paired. Open Cursor’s dashboard and select Sync Now.', lastSync: null });
    return { ok: true, message: 'Paired. Open Cursor’s dashboard and select Sync Now.' };
  }
  const saved = await chrome.storage.local.get(['token', 'message', 'lastSync']);
  if (message?.type === 'status' && fromPopup) return { ok: true, paired: !!saved.token, message: saved.message ?? 'Pair with the local tracker first.', lastSync: saved.lastSync ?? null };
  if (!fromDashboard) return { ok: false, message: 'Unsupported action.' };
  if (message?.type === 'can-read') return { ok: !!saved.token, message: saved.token ? 'Ready.' : 'Pair with the local tracker first.' };
  if (message?.type === 'read-failed') {
    await chrome.storage.local.set({ message: 'Cursor quota could not be read. Check the signed-in dashboard. Previous readings are kept.' });
    return { ok: true };
  }
  if (message?.type !== 'quota' || !saved.token) return { ok: false, message: 'Pair with the local tracker first.' };
  await post('reading', message.data, saved.token);
  await chrome.storage.local.set({ lastSync: new Date().toISOString(), message: 'Quota sent to the local tracker.' });
  return { ok: true, message: 'Quota sent to the local tracker.' };
}
let work = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const pending = work.then(() => handle(message, sender));
  work = pending.catch(() => {});
  void pending.then(respond).catch(async error => {
    // Never display raw browser/network/provider errors, which may contain private data.
    const known = ['Pair the extension again in the tracker.', 'Cursor returned an unsupported or delayed reading. Sync again; previous data is kept.', 'The tracker could not accept this update. Keep the Windows app open and try Sync Now again.', 'The tracker returned an invalid pairing response.'];
    const notice = known.includes(error?.message) ? error.message : 'Local tracker unavailable. Open the Windows app, then try again.';
    await chrome.storage.local.set({ message: notice }).catch(() => {});
    respond({ ok: false, message: notice });
  });
  return true;
});
