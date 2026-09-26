import StatusBadge from './StatusBadge';
import { formatTaka } from '../lib/format';

const NEXT_ACTION = {
  MATCHED: { label: 'Mark driver arrived', action: 'arrive' },
  DRIVER_ARRIVED: { label: 'Start trip', action: 'start' },
  STARTED: { label: 'Complete trip', action: 'complete' },
};

export default function PoolPanel({ pool, onAdvance, advancing }) {
  const next = NEXT_ACTION[pool.status];

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
            <span>{m.passenger_name}</span>
            <span className="text-ink/60">{formatTaka(m.final_fare_paisa)}</span>
          </li>
        ))}
      </ul>

      {next && (
        <button onClick={() => onAdvance(pool.id, next.action)} disabled={advancing} className="btn-primary w-full">
          {advancing ? 'Updating…' : next.label}
        </button>
      )}
    </div>
  );
}
