import StatusBadge from './StatusBadge';
import { formatTaka, POOL_DISCOUNT_DISPLAY_PERCENT } from '../lib/format';

// PENDING_CONFIRMATION is cancellable too — a passenger can leave outright
// instead of answering, distinct from declining (which returns them to
// REQUESTED: still wants a ride, just not this pool).
const CANCELLABLE = new Set(['REQUESTED', 'PENDING_CONFIRMATION', 'MATCHED']);
const SHARED_STATUSES = new Set(['MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED']);

const joinNames = (names) => names.join(', ');

export default function RideRequestCard({
  rideRequest,
  onCancel,
  cancelling,
  onConfirm,
  confirming,
  onDecline,
  declining,
  onApproveConsent,
  onRejectConsent,
  answeringConsentId,
}) {
  const canCancel = CANCELLABLE.has(rideRequest.status);
  const awaitingAgreement = rideRequest.status === 'PENDING_CONFIRMATION';
  const poolmates = rideRequest.poolmates || [];
  const waitingOn = rideRequest.waitingOn || [];
  const pendingConsents = rideRequest.pendingConsents || [];
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
            <p className="mt-1 text-sm text-ink/50">Sharing with {joinNames(poolmates.map((m) => m.name))}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <div className="text-right">
            <p className="font-display text-lg font-semibold">{formatTaka(rideRequest.final_fare_paisa)}</p>
            {rideRequest.status === 'REQUESTED' && (
              <p className="text-xs text-ink/50">estimate · up to {POOL_DISCOUNT_DISPLAY_PERCENT}% off if pooled</p>
            )}
          </div>
          {canCancel && !awaitingAgreement && (
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

      {/* You're the newcomer: everyone in the pool has to agree, you included. */}
      {awaitingAgreement && (
        <div className="mt-3 border border-amber/40 bg-amber/5 p-3">
          <p className="text-sm text-ink">
            {poolmates.length > 0
              ? `The driver wants to share this ride with ${joinNames(poolmates.map((m) => m.name))}, going to ${joinNames(
                  poolmates.map((m) => m.destination),
                )}.`
              : 'The driver wants to add you to a shared ride.'}{' '}
            Everyone has to agree — including them. Your seat is held meanwhile.
          </p>
          {rideRequest.ownConsentPending ? (
            <div className="mt-2 flex flex-wrap gap-3">
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
          ) : (
            <p className="mt-2 text-sm text-ink/70">
              You've agreed.
              {waitingOn.length > 0 && ` Waiting for ${joinNames(waitingOn)} to agree too.`}
            </p>
          )}
        </div>
      )}

      {/* You're already in the pool: a newcomer is being proposed, and you get a say. */}
      {pendingConsents.map((q) => (
        <div key={q.id} className="mt-3 border border-amber/40 bg-amber/5 p-3">
          <p className="text-sm text-ink">
            <strong>{q.joinerName}</strong> is being proposed to share your ride — picked up at {q.joinerPickup}, going
            to {q.joinerDestination}. Are you OK sharing with them?
          </p>
          <div className="mt-2 flex gap-3">
            <button
              onClick={() => onApproveConsent(q.id)}
              disabled={answeringConsentId === q.id}
              className="btn-primary"
            >
              Yes, share
            </button>
            <button
              onClick={() => onRejectConsent(q.id)}
              disabled={answeringConsentId === q.id}
              className="btn-secondary"
            >
              No, keep my ride as it is
            </button>
          </div>
        </div>
      ))}
    </li>
  );
}
