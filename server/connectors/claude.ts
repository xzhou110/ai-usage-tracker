import { mkdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ObservationSchema, type ConnectorResult, type ProviderConnector } from '../../shared/schema.ts';
import { atomicJson, quoteNativeArgument, readSmallJson, resolveNativeShell } from '../../tools/claude-statusline-bridge.mjs';
import { object } from './normalize.ts';
import { ConnectorError } from './errors.ts';
import { CLAUDE_DESKTOP_GUIDANCE, parseClaudeDesktop } from './claude-desktop.ts';
import { sameQuota } from '../store.ts';

interface Backup { version: 1; active: boolean; statusLinePresent: boolean; statusLine: unknown; installedCommand: string; installedStatusLine: Record<string, unknown> }
const generic = () => new ConnectorError('CLAUDE_SETTINGS_UNAVAILABLE', 'Claude settings could not be updated safely. Check native settings and retry; existing settings were preserved.');

async function readSettings(path: string) {
  try {
    const handle = await open(path, 'r');
    try {
      if ((await handle.stat()).size > 2_000_000) throw generic();
      const text = await handle.readFile('utf8');
      return { text, value: object(JSON.parse(text.replace(/^\uFEFF/, ''))) };
    } finally { await handle.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: null, value: {} as Record<string, unknown> }; throw generic(); }
}
async function readBackup(path: string): Promise<Backup | null> {
  let value;
  try { value = object(await readSmallJson(path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw generic(); }
  if (value.version !== 1 || typeof value.active !== 'boolean' || typeof value.statusLinePresent !== 'boolean' ||
      typeof value.installedCommand !== 'string' || !value.installedStatusLine || typeof value.installedStatusLine !== 'object') throw generic();
  return value as unknown as Backup;
}
async function unchanged(path: string, previous: string | null) {
  const current = await readSettings(path);
  if (current.text !== previous) throw new ConnectorError('CLAUDE_SETTINGS_CHANGED', 'Claude settings changed during connection. Your edit was preserved; reconnect to retry.');
}

export class ClaudeConnector implements ProviderConnector {
  private root: string;
  private settingsPath: string;
  constructor(root: string, settingsPath = join(homedir(), '.claude', 'settings.json')) { this.root = root; this.settingsPath = settingsPath; }
  private get backupPath() { return join(this.root, 'local', 'claude-statusline-backup.json'); }
  async desktopInstalled(): Promise<boolean> {
    try {
      const marker = object(await readSmallJson(join(this.root, 'local', 'claude-desktop-installed.json')));
      return marker.version === 1;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw generic(); }
  }
  private async desktopObservation() {
    try {
      const reading = ObservationSchema.parse(await readSmallJson(join(this.root, 'local', 'claude-desktop-inbox.json')));
      if (reading.provider !== 'claude' || reading.source !== 'claude-desktop-mod') throw generic();
      return reading;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw generic(); }
  }
  // Called only inside ProviderService's reservation and enabled-state transaction.
  async acceptDesktop(input: unknown) {
    if (!await this.desktopInstalled()) throw new ConnectorError('CLAUDE_DESKTOP_NOT_INSTALLED', 'Install the Claude Desktop bridge before sending quota.');
    const incoming = parseClaudeDesktop(input);
    const previous = await this.desktopObservation();
    // An older session's cached delivery cannot roll a newer observation back.
    if (previous && Date.parse(incoming.observedAt) < Date.parse(previous.observedAt)) return previous;
    const saved = previous && sameQuota(previous, incoming)
      ? { ...incoming, id: previous.id, observedAt: previous.observedAt } : incoming;
    await atomicJson(join(this.root, 'local', 'claude-desktop-inbox.json'), saved);
    return saved;
  }
  async connect(): Promise<ConnectorResult> {
    if (await this.desktopInstalled()) return this.refresh();
    const settings = await readSettings(this.settingsPath);
    const previous = await readBackup(this.backupPath);
    const shell = await resolveNativeShell();
    const script = quoteNativeArgument(join(this.root, 'tools', 'claude-statusline-bridge.mjs'), shell.kind);
    const command = `${shell.kind === 'powershell' ? '& ' : ''}${quoteNativeArgument(process.execPath, shell.kind)} ${script}`;
    const current = settings.value.statusLine;
    if (previous?.active && JSON.stringify(current) === JSON.stringify(previous.installedStatusLine) && previous.installedCommand === command) return this.refresh();
    if (previous?.active) throw new ConnectorError('CLAUDE_SETTINGS_CHANGED', 'Claude status-line settings changed after connection. Disconnect first; your current command will be kept.');
    if (current !== undefined && (!current || typeof current !== 'object' || Array.isArray(current))) throw generic();
    const statusLine = (current ?? {}) as Record<string, unknown>;
    if (current && (statusLine.type !== 'command' || typeof statusLine.command !== 'string')) throw generic();
    if (typeof statusLine.command === 'string' && /claude-statusline-bridge\.mjs/i.test(statusLine.command)) throw new ConnectorError('CLAUDE_BRIDGE_ALREADY_INSTALLED', 'A Claude quota bridge is already configured. Restore its original status line before connecting again.');
    const installedStatusLine = { ...statusLine, type: 'command', command };
    const backup: Backup = { version: 1, active: true, statusLinePresent: Object.hasOwn(settings.value, 'statusLine'), statusLine: current ?? null,
      installedCommand: command, installedStatusLine };
    await mkdir(join(this.root, 'local'), { recursive: true });
    await mkdir(dirname(this.settingsPath), { recursive: true });
    await unchanged(this.settingsPath, settings.text);
    await atomicJson(this.backupPath, backup);
    try {
      await unchanged(this.settingsPath, settings.text);
      await atomicJson(this.settingsPath, { ...settings.value, statusLine: installedStatusLine });
    } catch (error) {
      await atomicJson(this.backupPath, { ...backup, active: false }).catch(() => {});
      throw error;
    }
    return this.refresh();
  }
  async refresh(): Promise<ConnectorResult> {
    if (await this.desktopInstalled()) {
      const observation = await this.desktopObservation();
      return { observation, waiting: !observation, message: CLAUDE_DESKTOP_GUIDANCE };
    }
    const backup = await readBackup(this.backupPath);
    if (!backup?.active) throw new ConnectorError('CLAUDE_BRIDGE_NOT_CONNECTED', 'The Claude bridge is not connected. Select Connect to install the native status-line integration.');
    const settings = await readSettings(this.settingsPath);
    if (JSON.stringify(settings.value.statusLine) !== JSON.stringify(backup.installedStatusLine)) {
      throw new ConnectorError('CLAUDE_SETTINGS_CHANGED', 'Claude status-line settings changed after connection. Disconnect and reconnect to preserve the current command; the previous quota remains recorded.');
    }
    try {
      const incoming = ObservationSchema.parse(await readSmallJson(join(this.root, 'local', 'claude-inbox.json')));
      if (incoming.provider !== 'claude' || incoming.source !== 'claude-statusline') throw generic();
      return { observation: incoming, message: 'Claude Code sends quota during normal use. Refresh imports its latest stored reading; repeated data does not advance freshness.' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { observation: null, waiting: true,
        message: 'No quota has reached the terminal status-line bridge. Use Claude Code in a terminal signed in to your subscription during your normal work. Desktop or website activity alone does not establish this connection. Refresh only checks saved readings; view Claude Usage for current limits.' };
      throw new ConnectorError('CLAUDE_INBOX_UNAVAILABLE', 'The Claude quota inbox could not be read safely. Your previous observation is preserved.');
    }
  }
  async disconnect(): Promise<void> {
    const backup = await readBackup(this.backupPath);
    if (!backup?.active) return;
    const settings = await readSettings(this.settingsPath);
    if (JSON.stringify(settings.value.statusLine) !== JSON.stringify(backup.installedStatusLine)) {
      await atomicJson(this.backupPath, { ...backup, active: false });
      throw new ConnectorError('CLAUDE_SETTINGS_CHANGED', 'Claude status-line settings were edited after connection. Your current settings were kept; the old command remains in the local backup.');
    }
    const restored = { ...settings.value };
    if (backup.statusLinePresent) restored.statusLine = backup.statusLine; else delete restored.statusLine;
    await unchanged(this.settingsPath, settings.text);
    await atomicJson(this.settingsPath, restored);
    await atomicJson(this.backupPath, { ...backup, active: false });
  }
  async close(): Promise<void> { /* The passive bridge remains configured across app restarts. */ }
}
