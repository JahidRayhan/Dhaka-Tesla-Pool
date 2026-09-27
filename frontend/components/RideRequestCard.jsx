import StatusBadge from './StatusBadge';
import { formatTaka, POOL_DISCOUNT_DISPLAY_PERCENT } from '../lib/format';

// PENDING_CONFIRMATION is intentionally included here too — a passenger can
// cancel outright instead of responding to a pool invitation, distinct from
// declineRideRequest (which just returns them to REQUESTED, still wanting a
// ride, just not this pool).
const CANCELLABLE = new Set(['REQUESTED', 'PENDING_CONFIRMATION', 'MATCHED']);
const SHARED_STATUSES = new Set(['MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED']);

export default function RideRequestCard({
  rideRequest,
  onCancel,
  cancelling,
  onConfirm,
  confirming,
  onDecline,
  declining,
}) {
  const canCancel = CANCELLABLE.has(rideRequest.status);
  const awaitingConfirmation = rideRequest.status === 'PENDING_CONFIRMATION';
  const poolmates = rideRequest.poolmates || [];
  const showPoolmatesInline = SHARED_STATUSES.has(rideRequest.status) && poolmates.length > 0;

  return (
    <li className="border-b border-line py-4 last:border-0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium">
            {rideRequest.pickup_zone_name} <span className="text-ink/40">→</span> {rideRequest.destination_zone_name}
          </p>
          <div className="mt-1 flex items-center gap-2 text-sm text-ink/60">
            <StatusBadge status={rideRequest.status} />
            <span>{rideRequest.seats_requested} seat{rideRequest.seats_requested > 1 ? 's' : ''}</span>
          </div>
          {showPoolmatesInline && (
            <p className="mt-1 text-sm text-ink/50">
              Sharing with {poolmates.map((m) => m.name).join(', ')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <div className="text-right">
            <p className="font-display text-lg font-semibold">{formatTaka(rideRequest.final_fare_paisa)}</p>
            {rideRequest.status === 'REQUESTED' && (
              <p className="text-xs text-ink/50">estimate · up to {POOL_DISCOUNT_DISPLAY_PERCENT}% off if pooled</p>
            )}
          </div>
          {canCancel && !awaitingConfirmation && (
            <button
              onClick={() => onCancel(rideRequest.id)}
              disabled={cancelling}
              className="text-sm text-ink/50 underline decoration-line underline-offset-4 hover:text-rickshaw disabled:opacity-40"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {awaitingConfirmation && (
        <div className="mt-3 border border-amber/40 bg-amber/5 p-3">
          <p className="text-sm text-ink">
            {poolmates.length > 0
              ? `The driver wants to share this ride with ${poolmates.map((m) => m.name).join(', ')}, going to ${poolmates
                  .map((m) => m.destination)
                  .join(', ')}.`
              : 'The driver wants to add you to a shared ride.'}{' '}
            Your seat is held either way — decide when ready.
          </p>
          <div className="mt-2 flex gap-3">
            <button onClick={() => onConfirm(rideRequest.id)} disabled={confirming} className="btn-primary">
              {confirming ? 'Confirming…' : 'Confirm sharing'}
            </button>
            <button onClick={() => onDecline(rideRequest.id)} disabled={declining} className="btn-secondary">
              {declining ? 'Declining…' : "Don't share — keep waiting"}
            </button>
            <button
              onClick={() => onCancel(rideRequest.id)}
              disabled={cancelling}
              className="text-sm text-ink/50 underline decoration-line underline-offset-4 hover:text-rickshaw disabled:opacity-40"
            >
              Cancel ride entirely
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
