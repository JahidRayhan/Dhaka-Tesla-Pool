import { formatTaka } from '../lib/format';

export default function OpenRequestRow({ request, onAccept, accepting, actionLabel }) {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-line py-4 last:border-0">
      <div>
        <p className="font-medium">{request.passenger_name || 'Passenger'}</p>
        <p className="text-sm text-ink/60">
          {request.pickup_zone_name} <span className="text-ink/40">→</span> {request.destination_zone_name} ·{' '}
          {request.seats_requested} seat{request.seats_requested > 1 ? 's' : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <p className="font-display text-lg font-semibold">{formatTaka(request.final_fare_paisa)}</p>
        <button onClick={() => onAccept(request.id)} disabled={accepting} className="btn-primary">
          {accepting ? 'Accepting…' : actionLabel}
        </button>
      </div>
    </li>
  );
}
