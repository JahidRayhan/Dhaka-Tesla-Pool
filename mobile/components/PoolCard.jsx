import { Alert, Text, View } from 'react-native';
import { colors } from '../lib/theme';
import { formatTaka } from '../lib/format';
import { Banner, Button, Card, LinkButton, StatusBadge } from './ui';

const NEXT_ACTION = {
  MATCHED: { label: 'Mark driver arrived', action: 'arrive' },
  DRIVER_ARRIVED: { label: 'Start trip', action: 'start' },
  STARTED: { label: 'Complete trip', action: 'complete' },
};
// Once the trip has started passengers are in the vehicle: it can only be completed.
const CANCELLABLE = new Set(['MATCHED', 'DRIVER_ARRIVED']);

export default function PoolCard({ pool, onAdvance, advancing, onCancel, cancelling }) {
  const next = NEXT_ACTION[pool.status];
  const hasUnconfirmed = pool.members.some((m) => m.status === 'PENDING_CONFIRMATION');
  const blocked = pool.status === 'MATCHED' && hasUnconfirmed;

  function confirmCancel() {
    Alert.alert('Cancel this pool?', 'Everyone in it goes back to waiting for a driver.', [
      { text: 'Keep pool', style: 'cancel' },
      { text: 'Cancel pool', style: 'destructive', onPress: () => onCancel(pool.id) },
    ]);
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
        <View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{pool.tesla_name}</Text>
          <Text style={{ color: colors.muted, fontSize: 14 }}>
            {pool.seats_occupied}/{pool.capacity} seats
          </Text>
        </View>
        <StatusBadge status={pool.status} />
      </View>

      {pool.members.map((m) => (
        <View
          key={m.id}
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.line }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
            <Text style={{ color: colors.ink, fontSize: 15 }}>{m.passenger_name}</Text>
            {m.status === 'PENDING_CONFIRMATION' && <StatusBadge status={m.status} />}
          </View>
          <Text style={{ color: colors.muted, fontSize: 14 }}>{formatTaka(m.final_fare_paisa)}</Text>
        </View>
      ))}

      <View style={{ marginTop: 12, gap: 10 }}>
        {blocked && (
          <Banner
            tone="warn"
            text="A newcomer is waiting on the pool to agree to share — everyone has to say yes (within 5 minutes) before you can arrive."
          />
        )}
        {next && <Button title={next.label} onPress={() => onAdvance(pool.id, next.action)} loading={advancing} disabled={blocked} />}
        {CANCELLABLE.has(pool.status) && (
          <View style={{ alignItems: 'center' }}>
            <LinkButton title={cancelling ? 'Cancelling…' : 'Cancel pool'} onPress={confirmCancel} disabled={cancelling || advancing} />
          </View>
        )}
      </View>
    </Card>
  );
}
