import { useEffect, useRef, useState } from 'react';
import { Pencil, X } from 'lucide-react';
import type { DashboardSnapshot, Membership, ProviderState } from '../shared/schema';
import { MembershipSchema } from '../shared/schema';
import { errorMessage, request, RequestError } from './api';
import './membership.css';

export function subscriptionPrice(membership: Membership): string {
  if (membership.price === null) return 'Price Unknown';
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: membership.currency }).format(membership.price);
  return `${amount}${membership.billingPeriod === 'month' ? ' / month' : membership.billingPeriod === 'year' ? ' / year' : ' · Period Unknown'}`;
}

export function MembershipDialog({ provider, snapshot, reload, onClose }: { provider: ProviderState; snapshot: DashboardSnapshot; reload: () => Promise<DashboardSnapshot | null>; onClose: () => void }) {
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

export function MembershipButton({ provider, onEdit, compact = false }: { provider: ProviderState; onEdit: () => void; compact?: boolean }) {
  return <button className={compact ? "sidebar-membership" : "provider-membership"} aria-label={`Edit ${provider.name} Membership`} onClick={onEdit}><span><strong>{provider.membership.plan || 'Membership Unknown'}</strong><small>{subscriptionPrice(provider.membership)}{provider.membership.plan || provider.membership.price !== null ? ' · Your Entry' : ''}</small></span><Pencil size={14} /></button>;
}
