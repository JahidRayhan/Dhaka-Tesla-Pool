import { STATUS_LABEL, STATUS_TONE } from '../lib/format';

const TONE_CLASSES = {
  amber: 'border-amber/40 bg-amber/10 text-amber',
  transit: 'border-transit/30 bg-transit/10 text-transit-dark',
  ink: 'border-ink/20 bg-ink/5 text-ink/70',
};

export default function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] || 'ink';
  return (
    <span className={`inline-block rounded-sm border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}
