'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiRequestError } from '../../lib/api';
import { STATUS_LABEL } from '../../lib/format';

const REFRESH_MS = 10000;

// The page a friend opens from a shared link. It needs no account: it shows only
// what the server's public endpoint allows (first names, route, vehicle, and a
// recent position if there is one). The link lives in the query string
// (/trip?t=…) because the site is a static export, which cannot have a page per token.
function TripView() {
  const params = useSearchParams();
  const token = params.get('t');
  const [trip, setTrip] = useState(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.publicTrip(token);
      setTrip(data.trip);
      setError(null);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) setGone(true);
      else setError('Could not refresh. Trying again…');
    }
  }, [token]);

  useEffect(() => {
    load();
    const ended = trip && ['COMPLETED', 'CANCELLED'].includes(trip.status);
    if (gone || ended) return undefined;
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load, gone, trip]);

  if (!token || gone) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold">This link is not valid any more</h1>
        <p className="mt-2 text-ink/60">Trip links stop working when the trip has finished or the person turns sharing off.</p>
      </main>
    );
  }
  if (!trip) return <main className="mx-auto max-w-md px-4 py-16 text-center text-ink/60">Loading…</main>;

  const live = ['MATCHED', 'DRIVER_ARRIVED', 'STARTED'].includes(trip.status);
  const map = trip.location ? `https://www.openstreetmap.org/?mlat=${trip.location.latitude}&mlon=${trip.location.longitude}#map=16/${trip.location.latitude}/${trip.location.longitude}` : null;

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <p className="text-xs uppercase tracking-widest text-ink/50">Dhaka Tesla Pool · shared trip</p>
      <h1 className="mt-2 font-display text-3xl font-bold">{trip.passengerFirstName}&apos;s trip</h1>
      <p className="mt-1 text-lg">{trip.pickup} → {trip.destination}</p>
      {trip.pickupPoint && <p className="text-sm text-ink/60">Pickup point: {trip.pickupPoint}</p>}

      <div className="mt-5 rounded-sm border border-line bg-white p-4">
        <p className="text-sm text-ink/60">Status</p>
        <p className="font-display text-xl font-semibold">{STATUS_LABEL[trip.status] || trip.status}</p>
        {live && (
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-ink/60">Driver</dt><dd>{trip.driverFirstName}</dd></div>
            <div className="flex justify-between"><dt className="text-ink/60">Vehicle</dt><dd>{trip.teslaName}</dd></div>
            {trip.vehiclePlate && <div className="flex justify-between"><dt className="text-ink/60">Plate</dt><dd>{trip.vehiclePlate}</dd></div>}
          </dl>
        )}
        {map ? (
          <a href={map} target="_blank" rel="noreferrer" className="mt-4 inline-block underline decoration-line underline-offset-4">
            See the vehicle&apos;s last position (updated {new Date(trip.location.updatedAt).toLocaleTimeString()})
          </a>
        ) : (
          live && <p className="mt-4 text-sm text-ink/50">No recent position from the driver yet.</p>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-ink/50">{error}</p>}
      <p className="mt-6 text-xs text-ink/40">Updates every 10 seconds. This page shows first names only.</p>
    </main>
  );
}

export default function TripPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-4 py-16 text-center text-ink/60">Loading…</main>}>
      <TripView />
    </Suspense>
  );
}
