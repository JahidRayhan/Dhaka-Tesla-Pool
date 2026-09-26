'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Header from '../../components/Header';
import OpenRequestRow from '../../components/OpenRequestRow';
import PoolPanel from '../../components/PoolPanel';
import { useAuth } from '../../lib/AuthContext';
import { api, ApiRequestError } from '../../lib/api';

export default function DriverPage() {
  const { user, token, loading: authLoading } = useAuth();
  const router = useRouter();

  const [tesla, setTesla] = useState(undefined); // undefined = loading, null = none registered
  const [teslaForm, setTeslaForm] = useState({ name: '', capacity: 3 });
  const [togglingActive, setTogglingActive] = useState(false);

  const [openRequests, setOpenRequests] = useState([]);
  const [activePool, setActivePool] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [acceptingId, setAcceptingId] = useState(null);
  const [advancing, setAdvancing] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  const loadTesla = useCallback(async () => {
    if (!token) return;
    const data = await api.myTeslas(token);
    setTesla(data.teslas[0] || null);
  }, [token]);

  useEffect(() => {
    loadTesla();
  }, [loadTesla]);

  const loadBoard = useCallback(async () => {
    if (!token || !tesla) return;
    try {
      const [openData, poolsData] = await Promise.all([api.openRideRequests(token), api.myPools(token)]);
      setOpenRequests(openData.rideRequests);
      const mine = poolsData.pools[0];
      if (mine) {
        const detail = await api.poolDetail(token, mine.id);
        setActivePool(detail.pool);
      } else {
        setActivePool(null);
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiRequestError ? err.message : 'Could not load the board.');
    }
  }, [token, tesla]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  // Poll while online — a new request or a pool update should show up
  // without a manual refresh.
  useEffect(() => {
    if (!tesla?.is_active) return undefined;
    const id = setInterval(loadBoard, 4000);
    return () => clearInterval(id);
  }, [tesla, loadBoard]);

  async function handleRegisterTesla(e) {
    e.preventDefault();
    try {
      await api.createTesla(token, { name: teslaForm.name, capacity: Number(teslaForm.capacity) });
      await loadTesla();
    } catch (err) {
      setLoadError(err instanceof ApiRequestError ? err.message : 'Could not register the Tesla.');
    }
  }

  async function handleToggleActive() {
    setTogglingActive(true);
    try {
      await api.setTeslaActive(token, tesla.id, !tesla.is_active);
      await loadTesla();
    } catch (err) {
      setLoadError(err instanceof ApiRequestError ? err.message : 'Could not update status.');
    } finally {
      setTogglingActive(false);
    }
  }

  async function handleAccept(requestId) {
    setAcceptingId(requestId);
    setActionError(null);
    try {
      // A Tesla can only run one active pool at a time (Section 3) — join
      // it if one exists, otherwise start a new one.
      await api.acceptRideRequest(token, requestId, {
        teslaId: tesla.id,
        poolId: activePool ? activePool.id : undefined,
      });
      await loadBoard();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : 'Could not accept that request.');
    } finally {
      setAcceptingId(null);
    }
  }

  async function handleAdvance(poolId, action) {
    setAdvancing(true);
    setActionError(null);
    try {
      if (action === 'arrive') await api.arrivePool(token, poolId);
      if (action === 'start') await api.startPool(token, poolId);
      if (action === 'complete') await api.completePool(token, poolId);
      await loadBoard();
    } catch (err) {
      setActionError(err instanceof ApiRequestError ? err.message : 'Could not update the trip.');
    } finally {
      setAdvancing(false);
    }
  }

  if (authLoading || !user || tesla === undefined) return null;

  if (!tesla) {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-sm px-4 py-16">
          <h1 className="mb-1 font-display text-2xl font-bold">Register your Tesla</h1>
          <p className="mb-6 text-sm text-ink/60">Jashim's is seeded as "Bullet" — this form is for new drivers.</p>
          <form onSubmit={handleRegisterTesla} className="space-y-4">
            <div>
              <label className="field-label" htmlFor="tesla-name">
                Name
              </label>
              <input
                id="tesla-name"
                required
                value={teslaForm.name}
                onChange={(e) => setTeslaForm((f) => ({ ...f, name: e.target.value }))}
                className="field-input"
                placeholder="e.g. Bullet"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="tesla-capacity">
                Seats
              </label>
              <input
                id="tesla-capacity"
                type="number"
                min={1}
                max={6}
                required
                value={teslaForm.capacity}
                onChange={(e) => setTeslaForm((f) => ({ ...f, capacity: e.target.value }))}
                className="field-input"
              />
            </div>
            <button type="submit" className="btn-primary w-full">
              Register
            </button>
          </form>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <div className="mb-8 flex items-center justify-between border border-line p-4">
          <div>
            <p className="font-display text-lg font-bold">{tesla.name}</p>
            <p className="text-sm text-ink/60">{tesla.capacity} seats</p>
          </div>
          <button
            onClick={handleToggleActive}
            disabled={togglingActive}
            className={tesla.is_active ? 'btn-secondary' : 'btn-primary'}
          >
            <span
              className={`mr-2 inline-block h-2 w-2 rounded-full ${tesla.is_active ? 'bg-transit' : 'bg-ink/30'}`}
            />
            {tesla.is_active ? 'Online' : 'Go online'}
          </button>
        </div>

        {actionError && (
          <p role="alert" className="mb-4 rounded-sm border border-rickshaw/30 bg-rickshaw/5 px-3 py-2 text-sm text-rickshaw-dark">
            {actionError}
          </p>
        )}
        {loadError && (
          <p role="alert" className="mb-4 rounded-sm border border-rickshaw/30 bg-rickshaw/5 px-3 py-2 text-sm text-rickshaw-dark">
            {loadError}
          </p>
        )}

        {activePool && (
          <section className="mb-10">
            <h2 className="mb-4 font-display text-xl font-bold">Active pool</h2>
            <PoolPanel pool={activePool} onAdvance={handleAdvance} advancing={advancing} />
          </section>
        )}

        <section>
          <h2 className="mb-4 font-display text-xl font-bold">Open requests</h2>
          {!tesla.is_active ? (
            <p className="text-ink/50">Go online to see requests.</p>
          ) : openRequests.length === 0 ? (
            <p className="text-ink/50">No open requests right now.</p>
          ) : (
            <ul>
              {openRequests.map((r) => (
                <OpenRequestRow
                  key={r.id}
                  request={r}
                  onAccept={handleAccept}
                  accepting={acceptingId === r.id}
                  actionLabel={activePool ? 'Add to pool' : 'Accept'}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
