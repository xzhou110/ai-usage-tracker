import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronRight, CircleAlert, Clock3, Code2, Command, Info, Link2, LoaderCircle, Plug, RefreshCw, ShieldCheck, Sparkles, Unplug, X } from 'lucide-react';
import type { DashboardSnapshot, ProviderId, ProviderState, QuotaWindow, UsageAction } from '../shared/schema';
import { countdown, dateTime, nativeAmount, percentage, providerHealth, relativeTime, remaining, resetPassed, sourceNames } from './display';
import { request, errorMessage } from './api';

export const connectionCopy: Record<ProviderId, { summary: string; limitation: string; what: string; why: string; user: string; action: string }> = {
  claude: {
    summary: 'Claude Desktop Code sends quota through the local bridge.',
    limitation: 'Requires the local Claude Code bridge and an open local Code session. Refresh checks saved readings; it cannot query a closed Claude session.',
    what: 'The AI Usage Tracker bridge is a local Claude Code mod. It receives only reported allowance percentages and reset times, and sends them to this PC. It also works in terminal Code sessions; Desktop chat and cloud Code sessions are not verified.',
    why: 'Desktop Code does not run the terminal status line. Its supported mods API exposes the same quota counters without reading credentials, conversations, or generating a model request.',
    user: 'After bridge installation, open a new local Code session in Claude Desktop to load it, then continue normal work. Existing sessions may need to be reopened. Keep AI Usage Tracker running to receive updates. You control when to reopen Claude so active work is not interrupted. No paid test message is needed. For setup or repair, see claude-plugin/README.md in the project.',
    action: 'Connect Claude',
  },
  codex: {
    summary: 'Automatic readings from your installed Codex account.',
    limitation: 'Uses the account signed in to your installed Codex CLI. No model requests are made.',
    what: 'Read allowance windows from the Codex installation on this PC, using the account already signed in there.',
    why: 'The local Codex account reports its own usage and reset times. Reading these counters does not start a model turn or consume inference credits.',
    user: 'If sign-in is requested, sign in through Codex yourself. Only you can choose the account and complete its authentication.',
    action: 'Connect Codex',
  },
  cursor: {
    summary: 'Connect the extension in your normal Cursor browser.',
    limitation: 'Experimental browser extension. Updates every five minutes while the signed-in dashboard tab is open. Closed or sleeping tabs stop updates.',
    what: 'A small local extension reads quota from your already signed-in Cursor dashboard. It sends only allowance and reset fields to this tracker on your PC, after you pair it. Passwords and login cookies stay in the browser.',
    why: 'Cursor rejected the tracker-controlled sign-in browser, including email sign-in. This connection leaves login and human verification in your normal browser.',
    user: 'Install the local extension in the browser where Cursor already works, then pair it below. Only you can approve its browser access and verify your account. Keep Cursor’s dashboard tab open for updates; use Sync Now in the extension for an immediate reading. Compare the first reading with Cursor Spending before relying on it.',
    action: 'Open Cursor Dashboard',
  },
};

export function ProviderMark({ id, small = false }: { id: ProviderId; small?: boolean }) {
  return <span className={`provider-mark ${id} ${small ? 'small' : ''}`} aria-hidden="true">{id === 'claude' ? <Sparkles /> : id === 'codex' ? <Command /> : <Code2 />}</span>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}><span className="status-dot" />{children}</span>;
}

export function EmptyState({ icon, title, children, compact = false }: { icon: ReactNode; title: string; children: ReactNode; compact?: boolean }) {
  return <div className={`empty-state ${compact ? 'compact' : ''}`}><span className="empty-icon">{icon}</span><h3>{title}</h3><div>{children}</div></div>;
}

function WindowReading({ window, now, timezone, warningPercent, disconnected }: { window: QuotaWindow; now: number; timezone: string; warningPercent: number; disconnected: boolean }) {
  const expired = resetPassed(window, now);
  const left = remaining(window.usedPercent);
  const native = nativeAmount(window);
  const tone = window.usedPercent !== null && window.usedPercent >= 100 ? 'danger' : window.usedPercent !== null && window.usedPercent >= warningPercent ? 'warning' : 'accent';
  if (window.kind === 'spend') return <div className="spend-reading"><div><span className="overline">Separate Spending</span><h4>{window.label}</h4></div><strong>{native ?? 'Amount Unknown'}</strong>{window.detail && <p>{window.detail}</p>}{window.resetAt && <p>Reported reset: {dateTime(window.resetAt, timezone)}</p>}</div>;
  return <section className={`window-reading ${expired || disconnected ? 'historical-reading' : ''}`}>
    <div className="window-heading"><h4>{window.label}</h4>{window.scope === 'team' && <span className="small-label">Team</span>}</div>
    <div className="quota-value">{left === null ? <strong className="unknown-value">Unknown</strong> : <><strong>{percentage(left)}</strong><span>Remaining</span></>}</div>
    {window.usedPercent === null ? <div className="unknown-track" aria-label="Usage percentage unknown" /> : <div className={`progress-track ${tone}`} role="progressbar" aria-label={`${window.label} used quota`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, window.usedPercent)} aria-valuetext={`${percentage(window.usedPercent)} used`}><span style={{ width: `${Math.min(100, window.usedPercent)}%` }} /></div>}
    <div className="quota-caption"><span>{window.usedPercent === null ? 'Usage Percentage Unknown' : `${percentage(window.usedPercent)} Used`}</span>{native && <span>{native}</span>}</div>
    <div className={`window-reset ${expired ? 'warning-text' : ''}`}><Clock3 size={14} /><span>{expired ? 'Reset Passed · Awaiting Confirmation' : window.resetAt ? `Resets in ${countdown(window.resetAt, now)}` : 'Reset Time Unknown'}</span></div>
    {window.resetAt && <time className="reset-date" dateTime={window.resetAt}>{dateTime(window.resetAt, timezone)}</time>}
    {window.detail && <p className="window-detail">{window.detail}</p>}
  </section>;
}

export function ProviderCard({ provider, snapshot, now, busy, onConnect, onRefresh }: { provider: ProviderState; snapshot: DashboardSnapshot; now: number; busy: boolean; onConnect: () => void; onRefresh: () => void }) {
  const health = providerHealth(provider, now, snapshot.settings.staleAfterMinutes);
  const windows = provider.observation?.windows ?? [];
  const modes = { automatic: 'Automatic', passive: 'During Claude Use', experimental: 'Experimental' };
  return <article className={`provider-card provider-${provider.id}`} aria-labelledby={`provider-${provider.id}`}>
    <header className="provider-heading"><div className="provider-identity"><ProviderMark id={provider.id} /><div><h3 id={`provider-${provider.id}`}>{provider.name}</h3><span className="provider-mode">{modes[provider.mode]}</span></div></div><Badge tone={health.tone}>{health.label}</Badge></header>
    <div className="provider-content">
      {windows.length > 0 ? <div className="window-list">{windows.filter(window => window.kind === 'quota').map(window => <WindowReading key={window.key} window={window} now={now} timezone={snapshot.settings.timezone} warningPercent={snapshot.settings.warningPercent} disconnected={!provider.enabled} />)}{windows.filter(window => window.kind === 'spend').map(window => <WindowReading key={window.key} window={window} now={now} timezone={snapshot.settings.timezone} warningPercent={snapshot.settings.warningPercent} disconnected={!provider.enabled} />)}</div> : <div className="provider-empty"><span className="empty-provider-symbol"><Plug size={22} /></span><h4>{provider.status === 'connecting' ? 'Connecting Your Account' : provider.status === 'waiting' ? 'Waiting for a Reading' : 'No Reading Yet'}</h4><p>{connectionCopy[provider.id].summary}</p></div>}
      {provider.message && provider.enabled && <p className={`provider-message ${provider.status === 'error' ? 'error-text' : ''}`}><Info size={14} /><span>{provider.message}</span></p>}
    </div>
<div className="provider-meta"><div><span>{provider.observation ? 'Last Observation' : 'Account Connection'}</span><strong title={provider.observation ? dateTime(provider.observation.observedAt, snapshot.settings.timezone, true) : undefined}>{provider.observation ? relativeTime(provider.observation.observedAt, now) : provider.enabled ? 'Enabled' : 'Not Connected'}</strong></div>{provider.observation && <div className="source-line">{sourceNames[provider.observation.source]} <span>· {provider.verified ? 'Live Verified' : provider.id === 'codex' ? 'Provider-Reported' : 'Not Yet Reconciled'}</span></div>}</div>
    <footer className="provider-footer">{provider.id === 'cursor' ? <button className="button secondary grow" onClick={onConnect}><Info size={15} />Connection Details</button> : provider.enabled ? <><button className="button secondary grow" onClick={onRefresh} disabled={busy || provider.status === 'connecting'} aria-label={`Refresh ${provider.name}`}><RefreshCw size={15} className={busy || provider.status === 'connecting' ? 'spinning' : ''} />Refresh</button><button className="button icon-button" title={`Manage ${provider.name} Connection`} aria-label={`Manage ${provider.name} Connection`} onClick={onConnect}><Link2 size={17} /></button></> : <button className="button secondary grow" onClick={onConnect}><Plug size={15} />Connect {provider.name}<ArrowRight size={15} className="push-right" /></button>}<a className="button icon-button" href={provider.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open ${provider.name} Official Usage`} title="Official Usage"><ArrowUpRight size={18} /></a></footer>
    {provider.enabled && <p className="collection-note">{connectionCopy[provider.id].limitation}</p>}
  </article>;
}

export function ResetTimeline({ snapshot, now }: { snapshot: DashboardSnapshot; now: number }) {
  const quotaWindows = snapshot.providers.flatMap(provider => (provider.observation?.windows ?? []).filter(window => window.kind === 'quota').map(window => ({ provider, window })));
  const upcoming = quotaWindows.filter(({ window }) => window.resetAt && !resetPassed(window, now)).sort((a, b) => Date.parse(a.window.resetAt!) - Date.parse(b.window.resetAt!));
  const passed = quotaWindows.filter(({ window }) => resetPassed(window, now));
  const unknown = quotaWindows.filter(({ window }) => !window.resetAt);
  return <section className="panel reset-panel"><div className="panel-heading"><div className="section-title"><Clock3 size={18} /><h2>Upcoming Resets</h2></div><span className="small-label">{snapshot.settings.timezone.replaceAll('_', ' ')}</span></div>
    {upcoming.length ? <ol className="reset-timeline">{upcoming.map(({ provider, window }) => <li key={`${provider.id}-${window.key}`}><ProviderMark id={provider.id} small /><div className="timeline-label"><strong>{provider.name} <span>· {window.label}</span></strong><time dateTime={window.resetAt!}>{dateTime(window.resetAt, snapshot.settings.timezone)}</time>{(!provider.enabled || provider.freshness !== 'fresh') && <span className="warning-text">Last reported reset · reading may be out of date</span>}</div><span className="countdown-pill">{countdown(window.resetAt, now)}</span></li>)}</ol> : <EmptyState compact icon={<Clock3 size={25} />} title="Your Reset Schedule Starts Here"><p>{quotaWindows.length ? 'There are no confirmed future reset times in the latest readings.' : 'Connect an account to see its reported reset windows and a live countdown.'}</p></EmptyState>}
    {passed.length > 0 && <div className="reset-exceptions"><h3>Awaiting Confirmation</h3>{passed.map(({ provider, window }) => <p key={`${provider.id}-${window.key}`}><CircleAlert size={14} /><span>{provider.name} · {window.label} <small>Refresh to confirm the allowance after {dateTime(window.resetAt, snapshot.settings.timezone)}.</small></span></p>)}</div>}
    {unknown.length > 0 && <div className="reset-exceptions"><h3>Reset Time Unknown</h3>{unknown.map(({ provider, window }) => <p key={`${provider.id}-${window.key}`}><Clock3 size={14} /><span>{provider.name} · {window.label}</span></p>)}</div>}
    <div className="panel-footnote">Reset times come from each provider. A passed timer does not confirm a renewed allowance.</div>
  </section>;
}

export function ActionSummary({ actions }: { actions: UsageAction[] }) {
  const open = actions.filter(action => action.state === 'open');
  return <section className="panel action-summary"><div className="panel-heading"><div className="section-title"><CircleAlert size={18} /><h2>Action Required</h2></div><span className="count-badge">{open.length}</span></div>{open.length ? <div className="action-preview-list">{open.slice(0, 3).map(action => <a key={action.id} className="action-preview" href="#actions"><span className={`action-bullet ${action.severity}`} /><div><strong>{action.title}</strong><p>{action.description}</p></div><ChevronRight size={16} /></a>)}</div> : <EmptyState compact icon={<Check size={25} />} title="Nothing Needs Your Attention"><p>Connection and allowance notices will appear here.</p></EmptyState>}<a className="panel-link" href="#actions">{open.length > 3 ? `View All ${open.length} Actions` : 'View Actions and History'}<ArrowRight size={15} /></a></section>;
}

export function ConnectionDialog({ provider, onClose, onOperation, busy, error }: { provider: ProviderState; onClose: () => void; onOperation: (provider: ProviderId, operation: 'connect' | 'disconnect' | 'refresh') => Promise<boolean>; busy: boolean; error: string | null }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [notice, setNotice] = useState('');
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState('');
  async function createPairing() {
    setPairingBusy(true); setPairingError('');
    try { setPairing(await request('/cursor-browser/pairing', { method: 'POST' })); }
    catch (failure) { setPairingError(errorMessage(failure)); }
    finally { setPairingBusy(false); }
  }
  const copy = connectionCopy[provider.id];
  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); trigger?.focus(); };
  }, []);
  const operate = async (operation: 'connect' | 'disconnect' | 'refresh') => {
    setNotice('');
    if (operation === 'disconnect') setPairing(null);
    if (await onOperation(provider.id, operation)) setNotice(operation === 'disconnect' ? 'Disconnected. Your previous readings and history are kept locally.' : operation === 'connect' ? 'Connection requested. Follow the steps below while the tracker checks your account.' : 'Refresh requested. The connection status will update when the read finishes.');
  };
  return <dialog ref={dialogRef} className="connection-dialog" aria-labelledby="connection-title" onCancel={onClose} onClick={event => { if (event.target === dialogRef.current) onClose(); }}><div className="dialog-inner"><header className="dialog-heading"><div className="provider-identity"><ProviderMark id={provider.id} /><div><span className="overline">Account Connection</span><h2 id="connection-title">{provider.name}</h2></div></div><button className="button icon-button" onClick={onClose} aria-label="Close Connection Dialog"><X size={20} /></button></header>
    <div className="dialog-body"><div className="connection-state"><Badge tone={provider.status === 'error' ? 'danger' : provider.enabled ? 'accent' : 'neutral'}>{provider.id === 'cursor' ? provider.status === 'connected' ? 'Browser Connected' : 'Browser Setup' : provider.status === 'waiting' ? 'Waiting for Reading' : provider.status.charAt(0).toUpperCase() + provider.status.slice(1)}</Badge><span>{provider.id === 'cursor' ? 'Experimental' : provider.verified ? 'Live Reconciled' : provider.id === 'codex' ? 'Installed Account Source' : 'Live Reconciliation Pending'}</span></div><section><h3>What Happens</h3><p>{copy.what}</p></section><section><h3>Why It Is Needed</h3><p>{copy.why}</p></section><section className="your-part"><h3>Your Part</h3><p>{copy.user}</p></section>{provider.id === 'cursor' && <section className="browser-setup"><h3>One-Time Browser Setup</h3><ol><li>In Chrome or Edge, open Extensions, turn on Developer Mode, and choose Load Unpacked. This lets you install your own local extension; you must approve that browser access yourself.</li><li>Select <code>D:/Meaningful/AI/ai-usage-tracker/browser-extension</code>. Its access is limited to the Cursor dashboard and this PC’s local server; it does not read passwords or cookies.</li><li>Open Cursor Dashboard and reload it once to activate the extension on that tab.</li><li>Generate a code below, then paste it into the extension’s Pairing Code field and click Pair With Tracker. This authorizes quota updates to this local app. Click Sync Now for the first reading.</li></ol><button className="button secondary" disabled={pairingBusy} onClick={() => void createPairing()}>{pairingBusy ? 'Generating…' : 'Generate Pairing Code'}</button>{pairing && <label className="pairing-code">Local Pairing Code<input readOnly value={pairing.code} autoComplete="off" onFocus={event => event.currentTarget.select()} /><small>Copy into your extension only. Expires {dateTime(pairing.expiresAt, 'America/Los_Angeles')}; one use. A new code replaces the previous code.</small></label>}{pairingError && <p className="error-text" role="alert">{pairingError}</p>}</section>}<div className="privacy-note"><ShieldCheck size={17} /><p>Private on this PC. No prompts, conversations, or source code are collected.</p></div>{notice && <p className="inline-notice" role="status">{notice}</p>}{provider.enabled && <p className="connection-message">{provider.message}</p>}</div>
    {error && <p className="inline-error" role="alert">{error}</p>}<footer className="dialog-footer">{(provider.enabled || provider.id === 'cursor') && <button className="button text-button danger-text" onClick={() => void operate('disconnect')} disabled={busy || pairingBusy}><Unplug size={15} />{provider.id === 'cursor' ? 'Revoke Browser Access' : 'Disconnect'}</button>}<div className="dialog-primary-actions">{provider.id === 'cursor' ? <a className="button primary" href="https://cursor.com/dashboard?tab=usage" target="_blank" rel="noreferrer"><ArrowUpRight size={15} />{copy.action}</a> : <>{provider.enabled && <button className="button secondary" onClick={() => void operate('refresh')} disabled={busy || provider.status === 'connecting'}><RefreshCw size={15} />Refresh {provider.name}</button>}{(!provider.enabled || provider.status === 'error') && <button className="button primary" onClick={() => void operate('connect')} disabled={busy || provider.status === 'connecting'}>{busy ? <LoaderCircle size={15} className="spinning" /> : <Plug size={15} />}{copy.action}</button>}</>}<button className="button secondary" onClick={onClose}>Done</button></div></footer>
  </div></dialog>;
}
