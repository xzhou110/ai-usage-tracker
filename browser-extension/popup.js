const status = document.getElementById('status');
const code = document.getElementById('code');
const buttons = [...document.querySelectorAll('button')];
async function run(work) {
  buttons.forEach(button => { button.disabled = true; });
  try { const result = await work(); status.textContent = result?.message ?? 'Open Cursor’s dashboard, reload it once, then select Sync Now.'; }
  catch { status.textContent = 'Open Cursor’s dashboard in this tab and reload it once, then select Sync Now.'; }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
document.getElementById('pair').addEventListener('submit', event => {
  event.preventDefault();
  void run(async () => { const result = await chrome.runtime.sendMessage({ type: 'pair', code: code.value.trim().toLowerCase() }); if (result?.ok) code.value = ''; return result; });
});
document.getElementById('sync').addEventListener('click', () => void run(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error();
  return chrome.tabs.sendMessage(tab.id, { type: 'sync-now' });
}));
void run(() => chrome.runtime.sendMessage({ type: 'status' }));
