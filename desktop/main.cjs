const { app, BrowserWindow, screen, ipcMain, shell, dialog, session } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { ORIGIN, isAppUrl, isExternalUrl, sidebarBounds } = require('./policy.cjs');
const { createWindowControls } = require('./auto-hide.cjs');
const root = path.resolve(__dirname, '..');
app.setName('AI Usage Tracker');
app.setAppUserModelId('com.xuseak.ai-usage-tracker');
app.setPath('userData', path.join(root, 'local', 'desktop-profile'));
let window;
let server;
let closing = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(start).catch(() => {
    dialog.showErrorBox('AI Usage Tracker', 'The sidebar could not start. Run npm run build in the project, check that Node.js is installed, and close any older tracker server before trying again. Your saved data is unchanged.');
    app.quit();
  });
}

async function health() {
  try {
    const response = await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (!response.ok) return 'occupied';
    const result = await response.json();
    return result.app === 'ai-usage-tracker' && result.membershipApi === 1 ? 'ready' : 'occupied';
  } catch (error) { return error?.cause?.code === 'ECONNREFUSED' ? 'absent' : 'occupied'; }
}
async function ensureServer() {
  const status = await health();
  if (status === 'ready') return;
  if (status !== 'absent') throw new Error('An older or different service occupies the tracker port.');
  const childEnv = { ...process.env };
  delete childEnv.AI_USAGE_TRACKER_ROOT;
  delete childEnv.PORT;
  // Use installed Node 24: Electron's embedded Node may not support our TypeScript server.
  server = spawn('node.exe', [path.join(root, 'server', 'main.ts'), '8175'], {
    cwd: root, env: childEnv, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let failed = false;
  server.once('error', () => { failed = true; });
  server.once('exit', () => { failed = true; });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (failed) throw new Error('The tracker server could not start.');
    if (await health() === 'ready') return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('The tracker server did not become ready.');
}
async function start() {
  await ensureServer();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', event => event.preventDefault());
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  window = new BrowserWindow({
    ...sidebarBounds(area), minWidth: Math.min(340, area.width), minHeight: Math.min(420, area.height),
    title: 'AI Usage Tracker', autoHideMenuBar: true, show: false,
    backgroundColor: '#f6f8fb',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.setMenu(null);
  window.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  function trusted(event) {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppUrl(event.senderFrame.url)) throw new Error('Not allowed.');
  }
  const controls = createWindowControls(window, screen, state => {
    if (!window.webContents.isDestroyed()) window.webContents.send('tracker:window-state', state);
  });
  ipcMain.handle('tracker:minimize', event => { trusted(event); window.minimize(); });
  ipcMain.handle('tracker:window-state', event => { trusted(event); return controls.state(); });
  ipcMain.handle('tracker:auto-hide', (event, value) => { trusted(event); return controls.setAutoHide(value); });
  ipcMain.handle('tracker:interaction-hold', (event, value) => { trusted(event); controls.setInteractionHold(value); });
  ipcMain.handle('tracker:dashboard', event => { trusted(event); return shell.openExternal(`${ORIGIN}/#overview`); });
  window.once('ready-to-show', () => { window.show(); console.log('AI Usage Tracker sidebar ready.'); });
  await window.loadURL(`${ORIGIN}/#sidebar`);
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (closing || !server || server.exitCode !== null || !server.connected) return;
  event.preventDefault(); closing = true;
  const timer = setTimeout(() => { server.kill(); app.quit(); }, 5000);
  server.once('exit', () => { clearTimeout(timer); app.quit(); });
  server.send('shutdown', () => {});
});
