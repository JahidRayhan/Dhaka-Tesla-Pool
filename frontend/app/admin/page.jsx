'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '../../components/Header';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { formatTaka, STATUS_LABEL } from '../../lib/format';

const TABS = [['overview', 'Overview'], ['drivers', 'Driver verification'], ['rides', 'Rides']];
const RIDE_STATUSES = Object.keys(STATUS_LABEL);

export default function AdminPage() {
  const { user, token, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState('overview');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  const fail = useCallback((err) => setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.'), []);

  if (loading || !user) return null;
  if (user.role !== 'admin') {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-3xl px-4 py-10 text-ink/70">This page is for administrators.</main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="font-display text-2xl font-bold">Admin console</h1>
        <nav className="mt-4 flex gap-4 border-b border-line">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setTab(key); setError(null); }}
              className={`-mb-px border-b-2 pb-2 text-sm ${tab === key ? 'border-rickshaw font-semibold' : 'border-transparent text-ink/60'}`}
            >
              {label}
            </button>
          ))}
        </nav>
        {error && <p role="alert" className="mt-4 rounded-sm border border-rickshaw/40 bg-rickshaw/5 px-3 py-2 text-sm text-rickshaw">{error}</p>}
        <div className="mt-6">
          {tab === 'overview' && <Overview token={token} onError={fail} />}
          {tab === 'drivers' && <Drivers token={token} onError={fail} />}
          {tab === 'rides' && <Rides token={token} onError={fail} />}
        </div>
      </main>
    </>
  );
}

function Overview({ token, onError }) {
  const [stats, setStats] = useState(null);
  const [books, setBooks] = useState(null);
  useEffect(() => {
    api.adminStats(token).then(setStats).catch(onError);
    api.adminReconcile(token).then(setBooks).catch(onError);
  }, [token, onError]);
  if (!stats) return <p className="text-ink/60">Loading…</p>;
  const Row = ({ label, data }) => (
    <div className="rounded-sm border border-line bg-white p-4">
      <p className="text-sm text-ink/60">{label}</p>
      <p className="mt-1 text-sm">{Object.keys(data).length ? Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(' · ') : '—'}</p>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className={`rounded-sm border p-4 ${books?.ok ? 'border-transit/40 bg-transit/5' : 'border-rickshaw/40 bg-rickshaw/5'}`}>
        <p className="font-semibold">{books ? (books.ok ? 'The books balance' : 'THE BOOKS DO NOT BALANCE — investigate now') : 'Checking the books…'}</p>
        {books && !books.ok && <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(books, null, 2)}</pre>}
        <p className="mt-1 text-xs text-ink/60">Every wallet balance equals its opening balance plus its ledger, and every wallet-paid ride has matching ledger rows.</p>
      </div>
      <Row label="Accounts by role" data={stats.users} />
      <Row label="Rides, last 30 days" data={stats.ridesLast30Days} />
      <Row label="Pools" data={stats.pools} />
      <Row label="Driver verification" data={stats.driverVerification} />
      <div className="rounded-sm border border-line bg-white p-4">
        <p className="text-sm text-ink/60">Payments</p>
        <ul className="mt-1 text-sm">
          {stats.payments.map((p) => (
            <li key={`${p.method}${p.status}${p.kind}`}>{p.kind === 'NO_SHOW_FEE' ? 'No-show fee' : 'Fare'} · {p.method} · {p.status}: {p.count} ({formatTaka(p.amountPaisa)})</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Drivers({ token, onError }) {
  const [status, setStatus] = useState('PENDING');
  const [drivers, setDrivers] = useState(null);
  const [notes, setNotes] = useState({});
  const load = useCallback(() => api.adminDrivers(token, status).then((d) => setDrivers(d.drivers)).catch(onError), [token, status, onError]);
  useEffect(() => { load(); }, [load]);

  async function review(userId, decision) {
    try {
      await api.adminReviewDriver(token, userId, decision, notes[userId]);
      await load();
    } catch (err) { onError(err); }
  }
  return (
    <div>
      <div className="mb-4 flex gap-3 text-sm">
        {['PENDING', 'VERIFIED', 'REJECTED'].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={status === s ? 'font-semibold underline underline-offset-4' : 'text-ink/60'}>{s.toLowerCase()}</button>
        ))}
      </div>
      {!drivers ? <p className="text-ink/60">Loading…</p> : drivers.length === 0 ? <p className="text-ink/60">Nobody here.</p> : drivers.map((d) => (
        <div key={d.user_id} className="mb-3 rounded-sm border border-line bg-white p-4">
          <p className="font-semibold">{d.name} <span className="font-normal text-ink/60">· {d.email}</span></p>
          <p className="text-sm text-ink/70">Licence {d.license_number} · Plate {d.vehicle_plate} · Phone {d.phone || '—'} {d.phone_verified_at ? '(verified)' : '(not verified)'}</p>
          {d.review_note && <p className="text-sm text-ink/60">Note: {d.review_note}</p>}
          {d.status === 'PENDING' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input className="field-input max-w-xs" placeholder="Note (required to reject)" value={notes[d.user_id] || ''} onChange={(e) => setNotes((n) => ({ ...n, [d.user_id]: e.target.value }))} />
              <button className="btn-primary" onClick={() => review(d.user_id, 'VERIFIED')}>Verify</button>
              <button className="btn-secondary" onClick={() => review(d.user_id, 'REJECTED')}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Rides({ token, onError }) {
  const [status, setStatus] = useState('');
  const [rides, setRides] = useState(null);
  const [detail, setDetail] = useState(null);
  useEffect(() => { api.adminRides(token, status).then((d) => setRides(d.rides)).catch(onError); }, [token, status, onError]);
  return (
    <div>
      <select className="field-input mb-4 max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All statuses</option>
        {RIDE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {!rides ? <p className="text-ink/60">Loading…</p> : rides.map((r) => (
        <button key={r.id} onClick={() => api.adminRide(token, r.id).then(setDetail).catch(onError)} className="mb-2 flex w-full justify-between rounded-sm border border-line bg-white p-3 text-left text-sm hover:border-ink/40">
          <span>{r.passenger_name} · {r.pickup} → {r.destination}</span>
          <span className="text-ink/60">{r.status} · {formatTaka(r.final_fare_paisa)}</span>
        </button>
      ))}
      {detail && (
        <div className="mt-4 rounded-sm border border-line bg-white p-4 text-sm">
          <div className="flex justify-between"><p className="font-semibold">Ride history</p><button className="underline" onClick={() => setDetail(null)}>close</button></div>
          <ul className="mt-2 space-y-1">
            {detail.history.map((h, i) => (
              <li key={i}>{new Date(h.changed_at).toLocaleString()} · {h.entity_type}: {h.from_status || '—'} → {h.to_status}{h.note ? ` (${h.note})` : ''}{h.changed_by ? '' : ' · system'}</li>
            ))}
          </ul>
          <p className="mt-3 font-semibold">Payment</p>
          <p>{detail.payment ? `${detail.payment.kind} · ${detail.payment.method} · ${detail.payment.status} · ${formatTaka(detail.payment.amount_paisa)}` : 'none yet'}</p>
          <p className="mt-3 font-semibold">Ledger</p>
          <p>{detail.ledger.length ? detail.ledger.map((l) => `${l.kind} ${formatTaka(l.amount_paisa)}`).join(' · ') : 'no wallet movement'}</p>
        </div>
      )}
    </div>
  );
}
