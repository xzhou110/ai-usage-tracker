import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, Minus, Moon, PanelRight, Pencil, RefreshCw, Sun, X } from 'lucide-react';
import type { DashboardSnapshot, Membership, ProviderId, ProviderState } from '../shared/schema';
import { MembershipSchema } from '../shared/schema';
import { Badge, ProviderMark, connectionCopy } from './components';
import { countdown, dateTime, nativeAmount, percentage, providerHealth, relativeTime, resetPassed } from './display';
import { errorMessage, request, RequestError } from './api';
import './sidebar.css';

type WindowState = { autoHide: boolean; hidden: boolean };
declare global {
  interface Window {
    trackerDesktop?: { minimize(): Promise<void>; openDashboard(): Promise<void>; getWindowState?(): Promise<WindowState>; setAutoHide?(value: boolean): Promise<WindowState>; setInteractionHold?(value: boolean): Promise<void>; onWindowState?(callback: (state: WindowState) => void): () => void };
  }
}
export function subscriptionPrice(membership: Membership): string {
  if (membership.price === null) return 'Price Unknown';
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: membership.currency }).format(membership.price);
  return `${amount}${membership.billingPeriod === 'month' ? ' / month' : membership.billingPeriod === 'year' ? ' / year' : ' · Period Unknown'}`;
}

function MembershipDialog({ provider, snapshot, reload, onClose }: { provider: ProviderState; snapshot: DashboardSnapshot; reload: () => Promise<DashboardSnapshot | null>; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [plan, setPlan] = useState(provider.membership.plan ?? '');
  const [price, setPrice] = useState(provider.membership.price?.toString() ?? '');
  const [currency, setCurrency] = useState(provider.membership.currency);
  const [billingPeriod, setPeriod] = useState(provider.membership.billingPeriod);
  const [revision, setRevision] = useState(snapshot.revision);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError('');
    const parsed = MembershipSchema.safeParse({ plan: plan.trim() || null, price: price.trim() === '' ? null : Number(price), currency: currency.toUpperCase(), billingPeriod });
    if (!parsed.success) { setError('Enter a valid price and a three-letter currency code, such as USD.'); return; }
    setSaving(true);
    try { await request(`/providers/${provider.id}/membership`, { method: 'PUT', revision, body: parsed.data }); await reload(); onClose(); }
    catch (failure) {
      if (failure instanceof RequestError && failure.status === 412) {
        const latest = await reload();
        if (latest) setRevision(latest.revision);
        setError('The tracker changed while you were editing. Your entries are preserved. Review them, then Save Membership again.');
      } else setError(errorMessage(failure));
    } finally { setSaving(false); }
  }
  return <dialog className="membership-dialog" ref={ref} onCancel={event => { if (saving) event.preventDefault(); else onClose(); }} aria-labelledby="membership-title">
    <form onSubmit={save}>
      <header><h2 id="membership-title">{provider.name} Membership</h2><button type="button" className="button icon-button" disabled={saving} onClick={onClose} aria-label="Close Membership"><X size={18} /></button></header>
      <p>Enter your plan and the price you actually pay. These details stay on this PC and do not change your subscription or quota.</p>
      <label>Membership / Plan<input autoFocus value={plan} maxLength={160} onChange={event => setPlan(event.target.value)} placeholder="Plan Name" /></label>
      <label>Subscription Price<input type="number" min="0" step="any" value={price} onChange={event => setPrice(event.target.value)} placeholder="Unknown" /></label>
      <div className="membership-fields"><label>Currency<input value={currency} maxLength={3} pattern="[A-Za-z]{3}" required onChange={event => setCurrency(event.target.value.toUpperCase())} /></label>
      <label>Billing Period<select value={billingPeriod} onChange={event => setPeriod(event.target.value as Membership['billingPeriod'])}><option value="unknown">Unknown</option><option value="month">Monthly</option><option value="year">Yearly</option></select></label></div>
      <p className="small-label">Leave plan or price blank when unknown. A price of 0 means free.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      <footer><button type="button" className="button secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save Membership'}</button></footer>
    </form>
  </dialog>;
}

export function SidebarView({ snapshot, now, theme, toggleTheme, busy, refresh, connect, reload, loadError, notice }: {
  snapshot: DashboardSnapshot | null; now: number; theme: 'light' | 'dark'; toggleTheme: () => void;
  busy: Record<string, boolean>; refresh: (id: ProviderId) => void; connect: (id: ProviderId) => void;
  reload: () => Promise<DashboardSnapshot | null>; loadError: string; notice: { text: string; error: boolean } | null;
}) {
  const [editing, setEditing] = useState<ProviderId | null>(null);
  const [windowState, setWindowState] = useState<WindowState | null>(null);
  const [windowBusy, setWindowBusy] = useState(false);
  const [nativeError, setNativeError] = useState('');
  const desktop = window.trackerDesktop;
  const currentHost = !!desktop?.getWindowState && !!desktop?.setAutoHide && !!desktop?.setInteractionHold && !!desktop?.onWindowState;
  useEffect(() => {
    if (!desktop || !currentHost) return;
    let active = true;
    const update = (state: WindowState) => { if (active) setWindowState(state); };
    const synchronize = () => { void desktop.getWindowState!().then(update).catch(() => { if (active) setNativeError('Unable to read Windows controls. Close and reopen the sidebar.'); }); };
    const unsubscribe = desktop.onWindowState!(update);
    synchronize(); window.addEventListener('focus', synchronize);
    return () => { active = false; unsubscribe(); window.removeEventListener('focus', synchronize); };
  }, [desktop, currentHost]);
  useEffect(() => {
    if (!desktop || !currentHost) return;
    let lastHold: boolean | null = null;
    let keyboardUntil = 0;
    let keyboardTimer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const focused = document.activeElement;
      const value = !!document.querySelector('dialog[open]') || !!focused?.matches('input, textarea, select, [contenteditable="true"]') || Date.now() < keyboardUntil;
      if (value !== lastHold) { lastHold = value; void desktop.setInteractionHold!(value).catch(() => {}); }
    };
    const key = () => { keyboardUntil = Date.now() + 1500; update(); clearTimeout(keyboardTimer); keyboardTimer = setTimeout(update, 1500); };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    document.addEventListener('focusin', update); document.addEventListener('focusout', update); document.addEventListener('keydown', key);
    update();
    return () => { observer.disconnect(); clearTimeout(keyboardTimer); document.removeEventListener('focusin', update); document.removeEventListener('focusout', update); document.removeEventListener('keydown', key); void desktop.setInteractionHold!(false).catch(() => {}); };
  }, [desktop, currentHost]);
  const membershipProvider = snapshot?.providers.find(provider => provider.id === editing);
  async function native(action: () => Promise<unknown>) { setWindowBusy(true); try { await action(); if (currentHost) setWindowState(await desktop!.getWindowState!()); setNativeError(''); } catch { setNativeError('Windows could not apply the control. Close and reopen the sidebar, then try again.'); } finally { setWindowBusy(false); } }
  return <main className="usage-sidebar">
    <header className="usage-sidebar-header"><div><Activity size={21} /><h1>AI Usage Tracker</h1></div><span>By XuSeak · Private on This PC</span></header>
    <div className="usage-sidebar-toolbar"><button className="button secondary" onClick={toggleTheme}>{theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}{theme === 'light' ? 'Dark' : 'Light'}</button>
      <button className="button secondary window-toggle" disabled={!desktop || windowBusy || !windowState} title={desktop ? 'Hide at the Upper-Right Corner' : 'Available in the Windows App'} aria-pressed={windowState?.autoHide ?? false} onClick={() => desktop && void native(async () => setWindowState(await desktop.setAutoHide!(!windowState?.autoHide)))}><PanelRight size={14} />Auto-Hide<span>{desktop ? windowState ? windowState.autoHide ? 'On' : 'Off' : '…' : 'Off'}</span></button>
      {desktop && <button className="button icon-button" aria-label="Minimize Sidebar" title="Minimize to Taskbar" onClick={() => void native(() => desktop.minimize())}><Minus size={18} /></button>}
      {!desktop && <span className="small-label">Sidebar Preview</span>}
    </div>
    {desktop && !currentHost && <p className="sidebar-provider-warning" role="status">Window controls were updated. Close this Windows window and reopen AI Usage Tracker to activate them.</p>}
    {!desktop && <p className="sidebar-preview-note">This is a browser preview. Auto-Hide works in the separate Windows app. Open Start-AI-Usage-Sidebar.vbs from the project folder.</p>}
    {desktop && windowState?.autoHide && <p className="sidebar-preview-note">Move away to hide. Hover at this monitor’s upper-right corner to reveal. Editing keeps the sidebar open.</p>}
    {(loadError || nativeError) && <div className="notice error" role="alert"><p>{loadError || nativeError}</p>{loadError && <button className="button secondary" onClick={() => void reload()}>Retry</button>}</div>}
    {notice && <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><p>{notice.text}</p></div>}
    {!snapshot ? <p className="sidebar-loading">Loading Your Accounts…</p> : <div className="sidebar-accounts">{snapshot.providers.map(provider => {
      const health = providerHealth(provider, now, snapshot.settings.staleAfterMinutes);
      const windows = provider.observation?.windows ?? [];
      return <article className="sidebar-account" key={provider.id} aria-labelledby={`compact-${provider.id}`}>
        <header><div className="sidebar-account-name"><ProviderMark id={provider.id} small /><h2 id={`compact-${provider.id}`}>{provider.name}</h2></div><Badge tone={health.tone}>{health.label}</Badge></header>
        <button className="sidebar-membership" aria-label={`Edit ${provider.name} Membership`} onClick={() => setEditing(provider.id)}><span><strong>{provider.membership.plan || 'Membership Unknown'}</strong><small>{subscriptionPrice(provider.membership)}{provider.membership.plan || provider.membership.price !== null ? ' · Your Entry' : ''}</small></span><Pencil size={14} /></button>
        {windows.length === 0 ? <div className="sidebar-quota-empty"><strong>Usage Unknown</strong><span>Quota Refresh Unknown</span><p>{connectionCopy[provider.id].summary}</p></div> : windows.map(quota => <section className={`sidebar-quota ${resetPassed(quota, now) ? 'historical-reading' : ''}`} key={quota.key}>
          <div className="sidebar-quota-title"><strong>{quota.label}{quota.scope === 'team' ? ' · Team' : ''}</strong><span>{quota.kind === 'spend' ? 'Separate Spending' : quota.usedPercent === null ? 'Usage Unknown' : `${percentage(quota.usedPercent)} Used`}</span></div>
          {quota.kind === 'quota' && (quota.usedPercent === null ? <div className="unknown-track" aria-label="Usage Unknown" /> : <div className={`progress-track ${quota.usedPercent >= 100 ? 'danger' : quota.usedPercent >= snapshot.settings.warningPercent ? 'warning' : 'accent'}`} role="progressbar" aria-label={`${provider.name} ${quota.label} Used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, quota.usedPercent)} aria-valuetext={`${percentage(quota.usedPercent)} used`}><span style={{ width: `${Math.min(100, quota.usedPercent)}%` }} /></div>)}
          {(nativeAmount(quota) || quota.kind === 'spend') && <p>{nativeAmount(quota) || 'Amount Unknown'}</p>}
          <div className="sidebar-reset"><span>{resetPassed(quota, now) ? 'Reset Passed · Awaiting Confirmation' : quota.resetAt ? `Resets in ${countdown(quota.resetAt, now)}` : 'Reset Time Unknown'}</span>{quota.resetAt && <time dateTime={quota.resetAt}>{dateTime(quota.resetAt, snapshot.settings.timezone)}</time>}</div>
        </section>)}
        {(provider.status === 'error' || /ordinary usage|spending control/i.test(provider.message)) && <p className="sidebar-provider-warning">{provider.message}</p>}
        <footer><span title={provider.observation ? dateTime(provider.observation.observedAt, snapshot.settings.timezone) : undefined}>{provider.mode === 'experimental' ? 'Experimental · ' : ''}{provider.observation ? `Read ${relativeTime(provider.observation.observedAt, now)}` : 'No Reading Yet'}</span><div><button className="button icon-button" aria-label={`Manage ${provider.name} Connection`} title="Manage Connection" onClick={() => connect(provider.id)}><ArrowUpRight size={15} /></button>{provider.id === 'cursor' ? <button className="button secondary" onClick={() => connect(provider.id)}>Details</button> : provider.enabled ? <button className="button icon-button" aria-label={`Refresh ${provider.name}`} disabled={busy[provider.id] || provider.status === 'connecting'} onClick={() => refresh(provider.id)}><RefreshCw size={15} className={busy[provider.id] ? 'spinning' : ''} /></button> : <button className="button secondary" onClick={() => connect(provider.id)}>Connect</button>}</div></footer>
      </article>;
    })}</div>}
    <footer className="usage-sidebar-footer">{desktop ? <button className="button secondary" onClick={() => void native(() => desktop.openDashboard())}>Open Full Dashboard<ArrowUpRight size={14} /></button> : <a className="button secondary" href="#overview">Open Full Dashboard<ArrowUpRight size={14} /></a>}<p>{desktop ? 'Minimize to keep tracking in the background.' : 'Open Start-AI-Usage-Sidebar.vbs in the project folder for a Windows window.'}</p></footer>
    {membershipProvider && snapshot && <MembershipDialog provider={membershipProvider} snapshot={snapshot} reload={reload} onClose={() => setEditing(null)} />}
  </main>;
}
