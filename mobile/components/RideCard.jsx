import { Text, View } from 'react-native';
import { colors } from '../lib/theme';
import { formatTaka, joinNames, POOL_DISCOUNT_DISPLAY_PERCENT, timeLeftLabel } from '../lib/format';
import { Button, Card, LinkButton, StatusBadge } from './ui';

// PENDING_CONFIRMATION is cancellable too — leaving outright is different from
// declining (which returns the passenger to REQUESTED: still wants a ride).
const CANCELLABLE = new Set(['REQUESTED', 'PENDING_CONFIRMATION', 'MATCHED']);
const SHARED_STATUSES = new Set(['MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED']);

function paymentLine(r) {
  if (r.status === 'COMPLETED') {
    if (r.paid_with === 'TESLAPAY') return 'paid with TeslaPay';
    if (r.paid_with === 'CASH') return r.payment_method === 'TESLAPAY' ? 'wallet was short · pay driver in cash' : 'pay driver in cash';
    return null;
  }
  if (r.status === 'CANCELLED') return null;
  return r.payment_method === 'TESLAPAY' ? 'pays with TeslaPay' : null;
}

export default function RideCard({
  ride,
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
  const awaitingAgreement = ride.status === 'PENDING_CONFIRMATION';
  const canCancel = CANCELLABLE.has(ride.status);
  const poolmates = ride.poolmates || [];
  const waitingOn = ride.waitingOn || [];
  const pendingConsents = ride.pendingConsents || [];
  const showPoolmates = SHARED_STATUSES.has(ride.status) && poolmates.length > 0;
  const timeLeft = timeLeftLabel(ride.consentExpiresAt);
  const payLine = paymentLine(ride);

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>
            {ride.pickup_zone_name} → {ride.destination_zone_name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <StatusBadge status={ride.status} />
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {ride.seats_requested} seat{ride.seats_requested > 1 ? 's' : ''}
            </Text>
          </View>
          {showPoolmates && (
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
              Sharing with {joinNames(poolmates.map((m) => m.name))}
            </Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{formatTaka(ride.final_fare_paisa)}</Text>
          {ride.status === 'REQUESTED' && (
            <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'right' }}>
              estimate · up to {POOL_DISCOUNT_DISPLAY_PERCENT}% off if pooled
            </Text>
          )}
          {payLine && <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'right' }}>{payLine}</Text>}
          {canCancel && !awaitingAgreement && (
            <View style={{ marginTop: 8 }}>
              <LinkButton title="Cancel" onPress={() => onCancel(ride.id)} disabled={cancelling} />
            </View>
          )}
        </View>
      </View>

      {/* You're the newcomer: everyone in the pool, you included, has to agree. */}
      {awaitingAgreement && (
        <View style={{ marginTop: 12, borderWidth: 1, borderColor: colors.amber + '66', backgroundColor: colors.amber + '10', padding: 12 }}>
          <Text style={{ color: colors.ink, fontSize: 14 }}>
            {poolmates.length > 0
              ? `The driver wants to share this ride with ${joinNames(poolmates.map((m) => m.name))}, going to ${joinNames(
                  poolmates.map((m) => m.destination),
                )}.`
              : 'The driver wants to add you to a shared ride.'}{' '}
            Everyone has to agree — including them. Your seat is held meanwhile.
            {timeLeft ? ` Answer in time: ${timeLeft}.` : ''}
          </Text>
          {ride.ownConsentPending ? (
            <View style={{ marginTop: 10, gap: 8 }}>
              <Button title="Confirm sharing" onPress={() => onConfirm(ride.id)} loading={confirming} />
              <Button title="Don't share — keep waiting" variant="secondary" onPress={() => onDecline(ride.id)} loading={declining} />
              <View style={{ alignItems: 'center', marginTop: 4 }}>
                <LinkButton title="Cancel ride entirely" onPress={() => onCancel(ride.id)} disabled={cancelling} />
              </View>
            </View>
          ) : (
            <Text style={{ marginTop: 8, color: colors.ink, fontSize: 14 }}>
              You've agreed.{waitingOn.length > 0 ? ` Waiting for ${joinNames(waitingOn)} to agree too.` : ''}
            </Text>
          )}
        </View>
      )}

      {/* You're already in the pool: a newcomer is being proposed, and you get a say. */}
      {pendingConsents.map((q) => {
        const left = timeLeftLabel(q.expiresAt);
        return (
          <View key={q.id} style={{ marginTop: 12, borderWidth: 1, borderColor: colors.amber + '66', backgroundColor: colors.amber + '10', padding: 12 }}>
            <Text style={{ color: colors.ink, fontSize: 14 }}>
              <Text style={{ fontWeight: '700' }}>{q.joinerName}</Text> is being proposed to share your ride — picked up at{' '}
              {q.joinerPickup}, going to {q.joinerDestination}. Are you OK sharing with them?{left ? ` (${left})` : ''}
            </Text>
            <View style={{ marginTop: 10, gap: 8 }}>
              <Button title="Yes, share" onPress={() => onApproveConsent(q.id)} loading={answeringConsentId === q.id} />
              <Button
                title="No, keep my ride as it is"
                variant="secondary"
                onPress={() => onRejectConsent(q.id)}
                disabled={answeringConsentId === q.id}
              />
            </View>
          </View>
        );
      })}
    </Card>
  );
}
