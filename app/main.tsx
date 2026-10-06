import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowRight, CircleAlert, CircleUserRound, Clock3, History, LayoutDashboard, LoaderCircle, Moon, RefreshCw, Settings, ShieldCheck, Sun, X } from 'lucide-react';
import type { DashboardSnapshot, ProviderId, ProviderOperation } from '../shared/schema';
import { errorMessage, loadStatus, request, RequestError } from './api';
import { ActionSummary, ConnectionDialog, ProviderCard, ResetTimeline } from './components';
import { ActionsPage, HistoryPage, SettingsPage } from './pages';
import { dateTime, relativeTime } from './display';
import './styles.css';

const themeStorageKey = 'ai-usage-tracker-theme';
function initialTheme(): 'light' | 'dark' {
  try { const saved = localStorage.getItem(themeStorageKey); if (saved === 'dark' || saved === 'light') return saved; } catch { /* Storage can be unavailable in a restricted browser. */ }
  return 'light';
}
document.documentElement.dataset.theme = initialTheme();
type Page = 'overview' | 'history' | 'actions' | 'settings';
function currentPage(): Page { const page = location.hash.slice(1); return page === 'history' || page === 'actions' || page === 'settings' ? page : 'overview'; }

function App() {
  const [page, setPage] = useState<Page>(currentPage);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [theme, setTheme] = useState(initialTheme);
  const [connection, updateConnection] = useState<ProviderId | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [streamConnected, setStreamConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [profileOpen, setProfileOpen] = useState(false);
  const clockOffset = useRef(0);
  const latestRequest = useRef(0);
  const profileRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLElement>(null);
  const reload = useCallback(async () => {
    const requestId = ++latestRequest.current;
    try {
      const status = await loadStatus();
      if (requestId === latestRequest.current) {
        clockOffset.current = Date.parse(status.serverTime) - Date.now();
        setNow(Date.now() + clockOffset.current); setSnapshot(status); setLoadError('');
      }
      return status;
    } catch (error) { if (requestId === latestRequest.current) setLoadError(errorMessage(error)); return null; }
  }, []);
  useEffect(() => {
    void reload();
    // One EventSource is shared by all pages and provider cards.
    const events = new EventSource('/api/events');
    events.onopen = () => { setStreamConnected(true); void reload(); };
    events.onerror = () => setStreamConnected(false);
    events.addEventListener('change', () => void reload());
    const onFocus = () => void reload();
    const onVisibility = () => { if (document.visibilityState === 'visible') void reload(); };
    const onHash = () => { setPage(currentPage()); setProfileOpen(false); headingRef.current?.focus(); };
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onVisibility); window.addEventListener('hashchange', onHash);
    const interval = setInterval(() => setNow(Date.now() + clockOffset.current), 1_000);
    return () => { events.close(); clearInterval(interval); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('hashchange', onHash); };
  }, [reload]);
  useEffect(() => {
    if (!profileOpen) return;
    const click = (event: MouseEvent) => { if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setProfileOpen(false); profileRef.current?.querySelector('button')?.focus(); } };
    document.addEventListener('click', click); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', click); document.removeEventListener('keydown', key); };
  }, [profileOpen]);
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'; setTheme(next); document.documentElement.dataset.theme = next;
    try { localStorage.setItem(themeStorageKey, next); } catch { setNotice({ text: 'Theme changed for this visit. Browser storage is unavailable, so it may not persist.', error: false }); }
  };
  const operation = async (provider: ProviderId, operation: 'connect' | 'disconnect' | 'refresh'): Promise<boolean> => {
    setNotice(null);
    setBusy(previous => ({ ...previous, [provider]: true }));
    try {
      const response = await request<ProviderOperation | DashboardSnapshot>(`/providers/${provider}/${operation}`, { method: 'POST' });
      setNotice({ text: 'message' in response ? response.message : 'Connection disabled. Previous observations and history are preserved.', error: false });
      await reload(); return true;
    } catch (error) { setNotice({ text: errorMessage(error), error: true }); await reload(); return false; }
    finally { setBusy(previous => ({ ...previous, [provider]: false })); }
  };
  const refreshAll = async () => {
    setBusy(previous => ({ ...previous, all: true }));
    try {
      const response = await request<{ operations: ProviderOperation[] }>('/refresh', { method: 'POST' });
      const accepted = response.operations.filter(operation => operation.accepted).length;
      setNotice({ text: accepted ? `Refresh requested for ${accepted} ${accepted === 1 ? 'connection' : 'connections'}. Each source updates independently.` : response.operations[0]?.message || 'There are no enabled connections to refresh.', error: false });
      await reload();
    } catch (error) { setNotice({ text: errorMessage(error), error: true }); }
    finally { setBusy(previous => ({ ...previous, all: false })); }
  };
  const actionOperation = async (id: string, operation: 'dismiss' | 'reopen') => {
    if (!snapshot) return false;
    try {
      await request(`/actions/${encodeURIComponent(id)}/${operation}`, { method: 'POST', revision: snapshot.revision });
      await reload(); setNotice({ text: operation === 'dismiss' ? 'Notice moved to History.' : 'Notice reopened.', error: false }); return true;
    } catch (error) { await reload(); setNotice({ text: error instanceof RequestError && error.status === 412 ? 'The action list changed. It has been refreshed; please review it before trying again.' : errorMessage(error), error: true }); return false; }
  };
  const openActions = snapshot?.actions.filter(action => action.state === 'open').length ?? 0;
  const connected = snapshot?.providers.filter(provider => provider.status === 'connected').length ?? 0;
  const enabled = snapshot?.providers.filter(provider => provider.enabled).length ?? 0;
  const observed = snapshot?.providers.filter(provider => provider.observation !== null).length ?? 0;
  const latestObservation = snapshot?.providers.map(provider => provider.observation?.observedAt).filter((at): at is string => !!at).sort().at(-1) ?? null;
  const activeProvider = snapshot?.providers.find(provider => provider.id === connection);
  const setConnection = (id: ProviderId | null) => { setNotice(null); updateConnection(id); };
  const names = { overview: 'Overview', history: 'Usage History', actions: 'Action Required', settings: 'Settings' };
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); headingRef.current?.focus(); }}>Skip to Main Content</a>
    <aside className="sidebar">
      <a className="brand" href="#overview" aria-label="AI Usage Tracker Overview"><span className="brand-symbol"><Activity size={22} /></span><span><strong>AI Usage Tracker</strong><small>By XuSeak</small></span></a>
      <div className="sidebar-label">Workspace</div>
      <nav className="primary-navigation" aria-label="Main Navigation">
        <a href="#overview" className={page === 'overview' ? 'active' : ''} aria-current={page === 'overview' ? 'page' : undefined}><LayoutDashboard size={18} /><span>Overview</span></a>
        <a href="#history" className={page === 'history' ? 'active' : ''} aria-current={page === 'history' ? 'page' : undefined}><History size={18} /><span>Usage History</span></a>
        <a href="#actions" className={page === 'actions' ? 'active' : ''} aria-current={page === 'actions' ? 'page' : undefined}><CircleAlert size={18} /><span>Action Required</span>{openActions > 0 && <span className="navigation-count">{openActions}</span>}</a>
      </nav>
      <div className="sidebar-bottom"><div className="local-label"><ShieldCheck size={17} /><strong>Private on This PC</strong></div><p>Your usage stays local.<br />Your accounts stay yours.</p><div className="sidebar-footer">XuSeak<span>AI Usage Tracker</span></div></div>
    </aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb">Workspace<span>/</span><strong>{names[page]}</strong></div><div className="topbar-actions"><span className={`connection-indicator ${streamConnected ? 'online' : ''}`} title={streamConnected ? 'Connected to the local tracker' : 'Waiting for the local tracker'}><span />{streamConnected ? 'Local Connection' : 'Reconnecting'}</span><button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Theme`}><span className={theme === 'light' ? 'selected' : ''}><Sun size={14} />Light</span><span className={theme === 'dark' ? 'selected' : ''}><Moon size={14} />Dark</span></button><div className="profile-control" ref={profileRef}><button className={`button profile-button ${page === 'settings' ? 'selected' : ''}`} aria-label="Open Settings Menu" aria-expanded={profileOpen} onClick={() => setProfileOpen(value => !value)}><CircleUserRound size={23} /></button>{profileOpen && <div className="profile-menu"><a href="#settings" onClick={() => setProfileOpen(false)}><Settings size={16} />Settings</a></div>}</div></div></header>
    <main id="main-content" className="main-content" tabIndex={-1} ref={headingRef}>
      {notice && <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><CircleAlert size={17} /><p>{notice.text}</p><button className="button icon-button" onClick={() => setNotice(null)} aria-label="Dismiss Message"><X size={17} /></button></div>}
      {loadError && <div className="notice error" role="alert"><CircleAlert size={18} /><p>{loadError}{snapshot && ' Showing the last loaded dashboard.'}</p><button className="button secondary" onClick={() => void reload()}>Retry</button></div>}
      {!snapshot ? <div className="startup-state"><span className="brand-symbol"><Activity size={27} /></span><h1>AI Usage Tracker</h1>{loadError ? <p>Waiting for the local tracker to become available.</p> : <p><LoaderCircle size={17} className="spinning" />Loading Your Dashboard</p>}</div> : <>
      {page === 'overview' && <><div className="page-heading overview-heading"><div><span className="overline">Your Personal Usage Dashboard</span><h1>Your AI Usage, in One Place</h1><p>Know what’s left. Know when it resets. Keep building.</p></div><button className="button primary refresh-all" onClick={() => void refreshAll()} disabled={busy.all || enabled === 0}><RefreshCw size={16} className={busy.all ? 'spinning' : ''} />Refresh All</button></div><div className="overview-summary"><div className="summary-main"><span className={`summary-dot ${connected > 0 ? 'connected' : ''}`} /><strong>{enabled === 0 ? 'Connect Your First Account' : `${enabled} of 3 Connections Enabled`}</strong><span>{observed === 0 ? 'Your allowances will appear after the first reading.' : `${observed} ${observed === 1 ? 'provider has' : 'providers have'} recorded usage.`}</span></div><div className="summary-updated"><Clock3 size={14} /><span>{latestObservation ? `Last Reading ${relativeTime(latestObservation, now)}` : 'No Readings Yet'}</span></div></div><div className="section-caption"><h2>Your Accounts</h2><span>Separate allowances. One clear view.</span></div><div className="provider-grid">{snapshot.providers.map(provider => <ProviderCard key={provider.id} provider={provider} snapshot={snapshot} now={now} busy={!!busy[provider.id]} onConnect={() => setConnection(provider.id)} onRefresh={() => void operation(provider.id, 'refresh')} />)}</div><div className="overview-bottom"><ResetTimeline snapshot={snapshot} now={now} /><ActionSummary actions={snapshot.actions} /></div><div className="info-strip"><ShieldCheck size={17} /><p>Only provider-reported quota data. No prompts, no conversations, no estimates of your allowance.</p><a href="#settings">Privacy and Settings<ArrowRight size={14} /></a></div></>}
      {page === 'history' && <HistoryPage snapshot={snapshot} />}
      {page === 'actions' && <ActionsPage snapshot={snapshot} busy={busy} onConnect={setConnection} onRefresh={id => void operation(id, 'refresh')} onAction={actionOperation} />}
      {page === 'settings' && <SettingsPage snapshot={snapshot} reload={reload} onConnect={setConnection} />}
      <footer className="page-footer"><span>AI Usage Tracker <span className="footer-divider">/</span> XuSeak</span><span><ShieldCheck size={13} />Local Only<span className="footer-divider">·</span>{snapshot.settings.timezone.replaceAll('_', ' ')}</span></footer></>}
    </main></div>{activeProvider && <ConnectionDialog key={activeProvider.id} provider={activeProvider} onClose={() => setConnection(null)} onOperation={operation} busy={!!busy[activeProvider.id]} error={notice?.error ? notice.text : null} />}</div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
