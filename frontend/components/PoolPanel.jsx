import StatusBadge from './StatusBadge';
import { formatTaka } from '../lib/format';

const NEXT_ACTION = {
  MATCHED: { label: 'Mark driver arrived', action: 'arrive' },
  DRIVER_ARRIVED: { label: 'Start trip', action: 'start' },
  STARTED: { label: 'Complete trip', action: 'complete' },
};

const CANCELLABLE = new Set(['MATCHED', 'DRIVER_ARRIVED']);

export default function PoolPanel({ pool, onAdvance, advancing, onCancel, cancelling }) {
  const next = NEXT_ACTION[pool.status];
  const hasUnconfirmed = pool.members.some((m) => m.status === 'PENDING_CONFIRMATION');

  return (
    <div className="border border-line p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-display text-xl font-bold">{pool.tesla_name}</h3>
          <p className="text-sm text-ink/60">
            {pool.seats_occupied}/{pool.capacity} seats
          </p>
        </div>
        <StatusBadge status={pool.status} />
      </div>

      <ul className="mb-4">
        {pool.members.map((m) => (
          <li key={m.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
            <span className="flex items-center gap-2">
              {m.passenger_name}
              {m.status === 'PENDING_CONFIRMATION' && <StatusBadge status={m.status} />}
            </span>
            <span className="text-ink/60">{formatTaka(m.final_fare_paisa)}</span>
          </li>
        ))}
      </ul>

      {next && pool.status === 'MATCHED' && hasUnconfirmed && (
        <p className="mb-2 text-sm text-amber">A newcomer is waiting on the pool to agree to share — everyone in it has to say yes before you can arrive.</p>
      )}
      {next && (
        <button
          onClick={() => onAdvance(pool.id, next.action)}
          disabled={advancing || (pool.status === 'MATCHED' && hasUnconfirmed)}
          className="btn-primary w-full"
        >
          {advancing ? 'Updating…' : next.label}
        </button>
      )}
      {onCancel && CANCELLABLE.has(pool.status) && (
        <button
          onClick={() => {
            if (window.confirm('Cancel this pool? Everyone in it goes back to waiting for a driver.')) {
              onCancel(pool.id);
            }
          }}
          disabled={cancelling || advancing}
          className="mt-3 w-full text-sm text-ink/50 underline decoration-line underline-offset-4 hover:text-rickshaw disabled:opacity-40"
        >
          {cancelling ? 'Cancelling…' : 'Cancel pool'}
        </button>
      )}
    </div>
  );
}
