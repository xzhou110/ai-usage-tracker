import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, ArrowUpRight, Bell, Check, CheckCheck, CircleAlert, Clock3, Database, History, LoaderCircle, RotateCcw, Save, Settings2, ShieldCheck } from 'lucide-react';
import { SettingsSchema, type DashboardSnapshot, type Observation, type ProviderId, type Settings, type UsageAction } from '../shared/schema';
import { errorMessage, loadHistory, request, RequestError } from './api';
import { dateTime, mergeObservations, nativeAmount, percentage, remaining, sourceNames } from './display';
import { Badge, connectionCopy, EmptyState, ProviderMark } from './components';

export function HistoryPage({ snapshot }: { snapshot: DashboardSnapshot }) {
  const [provider, setProvider] = useState('all');
  const [windowKey, setWindowKey] = useState('all');
  const [observations, setObservations] = useState<Observation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const providerRef = useRef(provider);
  const pagingRef = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const changed = providerRef.current !== provider;
    providerRef.current = provider;
    if (changed) { setObservations([]); setNextCursor(null); setWindowKey('all'); pagingRef.current = false; }
    setLoading(true);
    loadHistory(provider, null, controller.signal).then(page => {
      setObservations(previous => changed ? page.observations : mergeObservations(previous, page.observations));
      // A newest-page refresh must not reset a cursor after older pages have loaded.
      setNextCursor(previous => changed || !pagingRef.current ? page.nextCursor : previous);
      setError('');
    }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [provider, snapshot.revision, retry]);
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const requestedProvider = provider;
    setLoadingMore(true);
    try {
      const page = await loadHistory(provider, nextCursor);
      if (providerRef.current !== requestedProvider) return;
      pagingRef.current = true;
      setObservations(previous => mergeObservations(previous, page.observations)); setNextCursor(page.nextCursor); setError('');
    } catch (error) { setError(errorMessage(error)); } finally { setLoadingMore(false); }
  };
  const windows = [...new Map(observations.flatMap(record => record.windows.map(window => [`${record.provider}:${window.key}`, { value: `${record.provider}:${window.key}`, label: `${record.provider.charAt(0).toUpperCase() + record.provider.slice(1)} · ${window.label}` }] as const))).values()];
  const rows = observations.flatMap(record => record.windows.filter(window => windowKey === 'all' || `${record.provider}:${window.key}` === windowKey).map(window => ({ record, window })));
  return <><div className="page-heading"><div><span className="overline">Your Local Record</span><h1>Usage History</h1><p>Every recorded allowance, with its original source and time.</p></div></div><section className="panel history-panel"><div className="history-toolbar"><div className="filter-field"><label htmlFor="history-provider">Provider</label><select id="history-provider" value={provider} onChange={event => setProvider(event.target.value)}><option value="all">All Providers</option><option value="claude">Claude</option><option value="codex">Codex</option><option value="cursor">Cursor</option></select></div><div className="filter-field window-filter"><label htmlFor="history-window">Quota Window</label><select id="history-window" value={windowKey} onChange={event => setWindowKey(event.target.value)}><option value="all">All Windows</option>{windows.map(window => <option key={window.value} value={window.value}>{window.label}</option>)}</select></div><span className="history-count">{observations.length} Observations Loaded</span></div>
    {error && <div className="inline-error" role="alert">{error}<button className="button text-button" onClick={() => setRetry(value => value + 1)}>Try Again</button></div>}
    {loading && observations.length === 0 ? <div className="loading-inline"><LoaderCircle size={20} className="spinning" />Loading History</div> : rows.length ? <div className="table-wrap"><table className="history-table"><thead><tr><th scope="col">Provider / Window</th><th scope="col">Observed At</th><th scope="col">Usage</th><th scope="col">Reported Reset</th><th scope="col">Source</th></tr></thead><tbody>{rows.map(({ record, window }) => <tr key={`${record.id}:${window.key}`}><td data-label="Provider / Window"><div className="table-provider"><ProviderMark id={record.provider} small /><div><strong>{record.provider.charAt(0).toUpperCase() + record.provider.slice(1)}</strong><span>{window.label}</span>{window.kind === 'spend' && <small>Separate Spending</small>}</div></div></td><td data-label="Observed At"><time dateTime={record.observedAt}>{dateTime(record.observedAt, snapshot.settings.timezone, true)}</time></td><td data-label="Usage"><strong>{window.kind === 'spend' ? nativeAmount(window) ?? 'Unknown' : window.usedPercent === null ? 'Unknown' : `${percentage(window.usedPercent)} Used`}</strong>{window.kind === 'quota' && window.usedPercent !== null && <span>{percentage(remaining(window.usedPercent)!)} Remaining</span>}{window.kind === 'quota' && nativeAmount(window) && <span>{nativeAmount(window)}</span>}</td><td data-label="Reported Reset">{dateTime(window.resetAt, snapshot.settings.timezone, true)}</td><td data-label="Source">{sourceNames[record.source]}</td></tr>)}</tbody></table></div> : <EmptyState icon={<History size={30} />} title={windowKey === 'all' ? 'No Observations Yet' : 'No Matching Observations'}><p>{windowKey === 'all' ? 'Connect a provider to start a private record of your usage. Only actual readings appear here.' : 'Choose another quota window or load more history.'}</p>{windowKey === 'all' && <a className="button secondary" href="#overview">Go to Overview<ArrowRight size={15} /></a>}</EmptyState>}
    <div className="history-footer"><p><Database size={14} />History is stored on this PC. Each row is a snapshot, not a usage estimate.</p>{nextCursor && <button className="button secondary" onClick={() => void loadMore()} disabled={loadingMore || loading}>{loadingMore && <LoaderCircle size={15} className="spinning" />}Load Older Observations</button>}</div></section></>;
}

export function ActionsPage({ snapshot, busy, onConnect, onRefresh, onAction }: { snapshot: DashboardSnapshot; busy: Record<string, boolean>; onConnect: (id: ProviderId) => void; onRefresh: (id: ProviderId) => void; onAction: (id: string, operation: 'dismiss' | 'reopen') => Promise<boolean> }) {
  const [tab, setTab] = useState<'open' | 'history'>('open');
  const [working, setWorking] = useState<string | null>(null);
  const navigateTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'open' : event.key === 'End' ? 'history' : tab === 'open' ? 'history' : 'open';
    setTab(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`#${next}-tab`)?.focus();
  };
  const openCount = snapshot.actions.filter(action => action.state === 'open').length;
  const actions = snapshot.actions.filter(action => tab === 'open' ? action.state === 'open' : action.state !== 'open').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const update = async (action: UsageAction) => { setWorking(action.id); await onAction(action.id, action.state === 'open' ? 'dismiss' : 'reopen'); setWorking(null); };
return <><div className="page-heading"><div><span className="overline">Stay Ahead of Your Limits</span><h1>Action Required</h1><p>Clear next steps for your connections and allowances.</p></div></div><section className="panel actions-panel"><div className="tabs" role="tablist" aria-label="Action Status" onKeyDown={navigateTabs}><button role="tab" tabIndex={tab === 'open' ? 0 : -1} aria-selected={tab === 'open'} aria-controls="action-list" id="open-tab" className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>Open<span className="count-badge">{openCount}</span></button><button role="tab" tabIndex={tab === 'history' ? 0 : -1} aria-selected={tab === 'history'} aria-controls="action-list" id="history-tab" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History<span className="count-badge">{snapshot.actions.length - openCount}</span></button></div><div id="action-list" role="tabpanel" tabIndex={0} aria-labelledby={tab === 'open' ? 'open-tab' : 'history-tab'}>{actions.length ? <div className="action-list">{actions.map(action => {
    const provider = snapshot.providers.find(provider => provider.id === action.provider)!;
    return <article className="action-row" key={action.id}><span className={`action-icon ${action.severity}`}>{action.state === 'resolved' ? <CheckCheck size={20} /> : <CircleAlert size={20} />}</span><div className="action-detail"><div className="action-title"><h3>{action.title}</h3>{action.state !== 'open' && <Badge tone={action.state === 'resolved' ? 'good' : 'neutral'}>{action.state === 'resolved' ? 'Resolved' : 'Dismissed'}</Badge>}</div><p>{action.description}</p><div className="action-metadata"><span>{provider.name}</span><span>First Seen {dateTime(action.firstSeenAt, snapshot.settings.timezone)}</span>{action.state === 'dismissed' && <span>Dismissed {dateTime(action.dismissedAt, snapshot.settings.timezone)}</span>}{action.state === 'resolved' && <span>Resolved {dateTime(action.resolvedAt, snapshot.settings.timezone)}</span>}</div><div className="action-row-controls">{action.state === 'open' && <>{provider.id === 'cursor' || !provider.enabled || action.kind === 'disconnected' || action.kind === 'waiting' ? <button className="button secondary" onClick={() => onConnect(provider.id)}>{provider.id === 'cursor' || provider.enabled ? 'Connection Details' : `Connect ${provider.name}`}<ArrowRight size={14} /></button> : <button className="button secondary" onClick={() => onRefresh(provider.id)} disabled={busy[provider.id] || provider.status === 'connecting'}>Refresh {provider.name}</button>}<a href={provider.sourceUrl} target="_blank" rel="noreferrer" className="button text-button">Official Usage<ArrowUpRight size={14} /></a></>}{action.state !== 'resolved' && <button className="button text-button muted-button" onClick={() => void update(action)} disabled={working === action.id}>{working === action.id ? <LoaderCircle size={14} className="spinning" /> : action.state === 'dismissed' ? <RotateCcw size={14} /> : <Check size={14} />}{action.state === 'open' ? 'Dismiss' : 'Reopen'}</button>}</div></div></article>;
  })}</div> : <EmptyState icon={tab === 'open' ? <CheckCheck size={30} /> : <History size={30} />} title={tab === 'open' ? 'You’re All Caught Up' : 'No Action History Yet'}><p>{tab === 'open' ? 'There are no open notices. New connection or allowance issues will appear here.' : 'Dismissed and resolved notices stay here, so you can see what changed.'}</p></EmptyState>}</div><div className="panel-footnote">Dismissing a notice keeps it in History. It does not change your connection, quota, or warning threshold.</div></section></>;
}

export function SettingsPage({ snapshot, reload, onConnect }: { snapshot: DashboardSnapshot; reload: () => Promise<DashboardSnapshot | null>; onConnect: (id: ProviderId) => void }) {
  const [draft, setDraft] = useState({ timezone: snapshot.settings.timezone, warningPercent: String(snapshot.settings.warningPercent), staleAfterMinutes: String(snapshot.settings.staleAfterMinutes) });
  const [baseRevision, setBaseRevision] = useState(snapshot.revision);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [latest, setLatest] = useState<DashboardSnapshot | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const edit = (key: keyof Settings, value: string) => { setDraft(previous => ({ ...previous, [key]: value })); setSaved(false); setFieldErrors(previous => ({ ...previous, [key]: '' })); };
  const save = async (revision = baseRevision) => {
    const parsed = SettingsSchema.safeParse({ timezone: draft.timezone.trim(), warningPercent: Number(draft.warningPercent), staleAfterMinutes: Number(draft.staleAfterMinutes) });
    if (!parsed.success) { setFieldErrors(Object.fromEntries(parsed.error.issues.map(issue => [issue.path[0], issue.path[0] === 'timezone' ? 'Enter a valid timezone, such as America/Los_Angeles.' : issue.path[0] === 'warningPercent' ? 'Enter a number from 1 to 100.' : 'Enter a positive whole number of minutes.']))); return; }
    setSaving(true); setError(''); setSaved(false);
    try {
      await request('/settings', { method: 'PUT', body: parsed.data, revision });
      const updated = await reload();
      if (updated) setBaseRevision(updated.revision);
      setConflict(false); setSaved(true);
    } catch (error) {
      if (error instanceof RequestError && error.status === 412) { setConflict(true); setLatest(await reload()); }
      else setError(errorMessage(error));
    } finally { setSaving(false); }
  };
  const loadSaved = async () => {
    const current = await reload();
    if (!current) { setError('Saved settings could not be loaded. Your edits are still here.'); return; }
    setDraft({ timezone: current.settings.timezone, warningPercent: String(current.settings.warningPercent), staleAfterMinutes: String(current.settings.staleAfterMinutes) });
    setBaseRevision(current.revision); setConflict(false); setError(''); setFieldErrors({}); setSaved(false);
  };
  return <><div className="page-heading"><div><span className="overline">Make It Yours</span><h1>Settings</h1><p>Manage connections and how your allowances are displayed.</p></div></div><div className="settings-layout"><section className="panel preferences-panel"><div className="panel-heading"><div className="section-title"><Settings2 size={18} /><h2>Display Preferences</h2></div></div><form onSubmit={event => { event.preventDefault(); void save(); }} noValidate><div className="settings-fields"><div className="field"><label htmlFor="timezone">Timezone</label><input id="timezone" value={draft.timezone} onChange={event => edit('timezone', event.target.value)} list="timezone-options" aria-invalid={!!fieldErrors.timezone} aria-describedby="timezone-help timezone-error" autoComplete="off" /><datalist id="timezone-options">{['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Paris', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney', 'UTC'].map(value => <option key={value} value={value} />)}</datalist><p id="timezone-help">Reset and observation times use this timezone, including daylight-saving changes.</p>{fieldErrors.timezone && <span id="timezone-error" className="field-error">{fieldErrors.timezone}</span>}</div><div className="field"><label htmlFor="warning-percent">Usage Warning Threshold</label><div className="input-unit"><input id="warning-percent" type="number" min="1" max="100" step="any" value={draft.warningPercent} onChange={event => edit('warningPercent', event.target.value)} aria-invalid={!!fieldErrors.warningPercent} aria-describedby="warning-help warning-error" /><span>% Used</span></div><p id="warning-help">Show a notice when a known allowance reaches this percentage. This is a warning preference; it does not restrict your usage.</p>{fieldErrors.warningPercent && <span id="warning-error" className="field-error">{fieldErrors.warningPercent}</span>}</div><div className="field"><label htmlFor="stale-minutes">Mark Readings Stale After</label><div className="input-unit"><input id="stale-minutes" type="number" min="1" step="1" value={draft.staleAfterMinutes} onChange={event => edit('staleAfterMinutes', event.target.value)} aria-invalid={!!fieldErrors.staleAfterMinutes} aria-describedby="stale-help stale-error" /><span>Minutes</span></div><p id="stale-help">An older reading stays visible with a stale label. This changes the freshness warning, not the collection schedule.</p>{fieldErrors.staleAfterMinutes && <span id="stale-error" className="field-error">{fieldErrors.staleAfterMinutes}</span>}</div></div>
    {conflict && <div className="settings-conflict" role="alert"><h3>Your Edits Are Still Here</h3><p>The dashboard changed after this form opened. Review the latest saved preferences before reapplying your edits.</p>{latest && <dl><div><dt>Saved Timezone</dt><dd>{latest.settings.timezone}</dd></div><div><dt>Saved Warning Threshold</dt><dd>{latest.settings.warningPercent}%</dd></div><div><dt>Saved Stale Threshold</dt><dd>{latest.settings.staleAfterMinutes} Minutes</dd></div></dl>}<div className="conflict-actions"><button type="button" className="button secondary" onClick={() => void loadSaved()} disabled={saving}>Load Saved Preferences</button><button type="button" className="button secondary" onClick={() => void save(latest!.revision)} disabled={saving || !latest}>Reapply My Edits</button></div></div>}{error && <p className="inline-error" role="alert">{error}</p>}<footer className="settings-form-footer"><span role="status">{saved && <><Check size={16} />Preferences Saved</>}</span><button className="button primary" type="submit" disabled={saving || conflict}>{saving ? <LoaderCircle className="spinning" size={16} /> : <Save size={16} />}Save Preferences</button></footer></form></section><div className="settings-side"><section className="panel"><div className="panel-heading"><div className="section-title"><ShieldCheck size={18} /><h2>Private by Design</h2></div></div><div className="privacy-details"><p>Your observations and connection sessions stay on this PC.</p><ul><li>Only quota metadata is collected.</li><li>No prompts, chats, or source code.</li><li>No cloud sync or analytics.</li><li>Disconnecting preserves your local history.</li></ul><div className="privacy-label"><Database size={16} />Local Storage Only</div></div></section><section className="panel connection-settings"><div className="panel-heading"><h2>Account Connections</h2></div>{snapshot.providers.map(provider => <button key={provider.id} className="settings-provider" onClick={() => onConnect(provider.id)}><ProviderMark id={provider.id} small /><span><strong>{provider.name}</strong><small>{provider.enabled ? 'Manage Connection' : 'Not Connected'}</small></span><ArrowRight size={16} /></button>)}</section></div></div><div className="info-strip"><Bell size={17} /><p>Warnings use your selected threshold. Each provider still controls its own limits and reset schedule.</p></div></>;
}
