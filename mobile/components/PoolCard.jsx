import { Alert, Text, View } from 'react-native';
import { useI18n } from '../lib/LanguageContext';
import { colors } from '../lib/theme';
import { Banner, Button, Card, LinkButton, StatusBadge } from './ui';

const NEXT_ACTION = {
  MATCHED: { key: 'markArrived', action: 'arrive' },
  DRIVER_ARRIVED: { key: 'startTrip', action: 'start' },
  STARTED: { key: 'completeTrip', action: 'complete' },
};
// Once the trip has started passengers are in the vehicle: it can only be completed.
const CANCELLABLE = new Set(['MATCHED', 'DRIVER_ARRIVED']);

export default function PoolCard({ pool, onAdvance, advancing, onCancel, cancelling, onNoShow }) {
  const { t, money } = useI18n();
  const next = NEXT_ACTION[pool.status];
  const hasUnconfirmed = pool.members.some((m) => m.status === 'PENDING_CONFIRMATION');
  const blocked = pool.status === 'MATCHED' && hasUnconfirmed;

  function confirmCancel() {
    Alert.alert(t('cancelPoolTitle'), t('cancelPoolBody'), [
      { text: t('keepPool'), style: 'cancel' },
      { text: t('cancelPool'), style: 'destructive', onPress: () => onCancel(pool.id) },
    ]);
  }

  function confirmNoShow(member) {
    Alert.alert(t('noShowTitle'), `${member.passenger_name}\n${t('noShowBody')}`, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('noShow'), style: 'destructive', onPress: () => onNoShow(pool.id, member.id) },
    ]);
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
        <View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{pool.tesla_name}</Text>
          <Text style={{ color: colors.muted, fontSize: 14 }}>
            {pool.seats_occupied}/{pool.capacity} {t('seats').toLowerCase()}
          </Text>
        </View>
        <StatusBadge status={pool.status} />
      </View>

      {pool.members.map((m) => (
        <View key={m.id} style={{ paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.line }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
              <Text style={{ color: colors.ink, fontSize: 15 }}>{m.passenger_name}</Text>
              {m.status === 'PENDING_CONFIRMATION' && <StatusBadge status={m.status} />}
            </View>
            <Text style={{ color: colors.muted, fontSize: 14 }}>{money(m.final_fare_paisa)}</Text>
          </View>
          {pool.status === 'DRIVER_ARRIVED' && m.status === 'DRIVER_ARRIVED' && onNoShow && (
            <View style={{ marginTop: 4 }}>
              <LinkButton title={t('noShow')} onPress={() => confirmNoShow(m)} />
            </View>
          )}
        </View>
      ))}

      <View style={{ marginTop: 12, gap: 10 }}>
        {blocked && <Banner tone="warn" text={t('blockedByProposal')} />}
        {next && <Button title={t(next.key)} onPress={() => onAdvance(pool.id, next.action)} loading={advancing} disabled={blocked} />}
        {CANCELLABLE.has(pool.status) && (
          <View style={{ alignItems: 'center' }}>
            <LinkButton title={cancelling ? t('cancelling') : t('cancelPool')} onPress={confirmCancel} disabled={cancelling || advancing} />
          </View>
        )}
      </View>
    </Card>
  );
}
