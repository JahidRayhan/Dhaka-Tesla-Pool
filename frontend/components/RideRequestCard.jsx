import StatusBadge from './StatusBadge';
import { formatTaka } from '../lib/format';

const CANCELLABLE = new Set(['REQUESTED', 'MATCHED']);

export default function RideRequestCard({ rideRequest, onCancel, cancelling }) {
  const canCancel = CANCELLABLE.has(rideRequest.status);

  return (
    <li className="flex items-center justify-between gap-4 border-b border-line py-4 last:border-0">
      <div>
        <p className="font-medium">
          {rideRequest.pickup_zone_name} <span className="text-ink/40">→</span> {rideRequest.destination_zone_name}
        </p>
        <div className="mt-1 flex items-center gap-2 text-sm text-ink/60">
          <StatusBadge status={rideRequest.status} />
          <span>{rideRequest.seats_requested} seat{rideRequest.seats_requested > 1 ? 's' : ''}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div className="text-right">
          <p className="font-display text-lg font-semibold">{formatTaka(rideRequest.final_fare_paisa)}</p>
          {rideRequest.status === 'REQUESTED' && <p className="text-xs text-ink/50">estimate</p>}
        </div>
        {canCancel && (
          <button
            onClick={() => onCancel(rideRequest.id)}
            disabled={cancelling}
            className="text-sm text-ink/50 underline decoration-line underline-offset-4 hover:text-rickshaw disabled:opacity-40"
          >
            Cancel
          </button>
        )}
      </div>
    </li>
  );
}
