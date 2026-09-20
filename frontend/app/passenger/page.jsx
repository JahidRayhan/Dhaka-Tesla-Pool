'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Header from '../../components/Header';
import RideRequestCard from '../../components/RideRequestCard';
import { useAuth } from '../../lib/AuthContext';
import { api, ApiRequestError } from '../../lib/api';

const ACTIVE_STATUSES = new Set(['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED']);

export default function PassengerPage() {
  const { user, token, loading: authLoading } = useAuth();
  const router = useRouter();

  const [zones, setZones] = useState([]);
  const [rides, setRides] = useState([]);
  const [loadingRides, setLoadingRides] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [pickupZoneId, setPickupZoneId] = useState('');
  const [destinationZoneId, setDestinationZoneId] = useState('');
  const [seats, setSeats] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  const loadRides = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.myRideRequests(token);
      setRides(data.rideRequests);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiRequestError ? err.message : 'Could not load your rides.');
    } finally {
      setLoadingRides(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api.zones().then((data) => {
      setZones(data.zones);
      if (data.zones.length > 1) {
        setPickupZoneId(String(data.zones[0].id));
        setDestinationZoneId(String(data.zones[1].id));
      }
    });
    loadRides();
  }, [token, loadRides]);

  // Poll while any ride is in a non-terminal state — cheap and correct
  // enough for an MVP; a websocket/push layer is a "next improvement".
  useEffect(() => {
    const hasActive = rides.some((r) => ACTIVE_STATUSES.has(r.status));
    if (!hasActive) return undefined;
    const id = setInterval(loadRides, 4000);
    return () => clearInterval(id);
  }, [rides, loadRides]);

  async function handleRequest(e) {
    e.preventDefault();
    setFormError(null);
    if (pickupZoneId === destinationZoneId) {
      setFormError('Pickup and destination must be different areas.');
      return;
    }
    setSubmitting(true);
    try {
      await api.createRideRequest(token, {
        pickupZoneId: Number(pickupZoneId),
        destinationZoneId: Number(destinationZoneId),
        seatsRequested: seats,
      });
      await loadRides();
    } catch (err) {
      setFormError(err instanceof ApiRequestError ? err.message : 'Could not request a ride.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id) {
    setCancellingId(id);
    try {
      await api.cancelRideRequest(token, id);
      await loadRides();
    } catch (err) {
      setLoadError(err instanceof ApiRequestError ? err.message : 'Could not cancel that ride.');
    } finally {
      setCancellingId(null);
    }
  }

  if (authLoading || !user) return null;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <section className="mb-10">
          <h1 className="mb-6 font-display text-2xl font-bold">Request a ride</h1>
          <form onSubmit={handleRequest} className="space-y-4 border border-line p-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label" htmlFor="pickup">
                  Pickup
                </label>
                <select
                  id="pickup"
                  value={pickupZoneId}
                  onChange={(e) => setPickupZoneId(e.target.value)}
                  className="field-input"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="destination">
                  Drop-off
                </label>
                <select
                  id="destination"
                  value={destinationZoneId}
                  onChange={(e) => setDestinationZoneId(e.target.value)}
                  className="field-input"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="field-label">Seats</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSeats((s) => Math.max(1, s - 1))}
                  className="btn-secondary h-9 w-9 p-0"
                  aria-label="Fewer seats"
                >
                  −
                </button>
                <span className="w-4 text-center font-medium">{seats}</span>
                <button
                  type="button"
                  onClick={() => setSeats((s) => Math.min(3, s + 1))}
                  className="btn-secondary h-9 w-9 p-0"
                  aria-label="More seats"
                >
                  +
                </button>
              </div>
            </div>

            {formError && (
              <p role="alert" className="rounded-sm border border-rickshaw/30 bg-rickshaw/5 px-3 py-2 text-sm text-rickshaw-dark">
                {formError}
              </p>
            )}

            <button type="submit" disabled={submitting || zones.length === 0} className="btn-primary">
              {submitting ? 'Requesting…' : 'Request a Tesla'}
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-4 font-display text-xl font-bold">Your rides</h2>
          {loadingRides ? (
            <p className="text-ink/50">Loading…</p>
          ) : loadError ? (
            <p role="alert" className="text-rickshaw-dark">
              {loadError}
            </p>
          ) : rides.length === 0 ? (
            <p className="text-ink/50">No rides yet — request one above to get started.</p>
          ) : (
            <ul>
              {rides.map((r) => (
                <RideRequestCard key={r.id} rideRequest={r} onCancel={handleCancel} cancelling={cancellingId === r.id} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
