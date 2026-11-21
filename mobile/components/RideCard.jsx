import { useState } from 'react';
import { Share, Text, View } from 'react-native';
import { api, ApiRequestError } from '../lib/api';
import { useI18n } from '../lib/LanguageContext';
import { POOL_DISCOUNT_DISPLAY_PERCENT, timeLeftLabel } from '../lib/format';
import { colors } from '../lib/theme';
import ReceiptModal from './ReceiptModal';
import { Banner, Button, Card, LinkButton, Stars, StatusBadge, Tag } from './ui';

// PENDING_CONFIRMATION is cancellable too — leaving outright is different from
// declining (which returns the passenger to REQUESTED: still wants a ride).
const CANCELLABLE = new Set(['REQUESTED', 'PENDING_CONFIRMATION', 'MATCHED']);
const SHARED_STATUSES = new Set(['MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED']);
const FOLLOWABLE = new Set(['REQUESTED', 'PENDING_CONFIRMATION', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED']);

const box = { marginTop: 12, borderWidth: 1, borderColor: colors.amber + '66', backgroundColor: colors.amber + '10', padding: 12 };

export default function RideCard({
  ride, token, onChanged,
  onCancel, cancelling, onConfirm, confirming, onDecline, declining,
  onApproveConsent, onRejectConsent, answeringConsentId,
}) {
  const { t, tn, money, num } = useI18n();
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [stars, setStars] = useState(0);
  const [rated, setRated] = useState(ride.rated);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const awaitingAgreement = ride.status === 'PENDING_CONFIRMATION';
  const canCancel = CANCELLABLE.has(ride.status);
  const poolmates = ride.poolmates || [];
  const waitingOn = ride.waitingOn || [];
  const pendingConsents = ride.pendingConsents || [];
  const showPoolmates = SHARED_STATUSES.has(ride.status) && poolmates.length > 0;
  const leftLabel = (iso) => {
    const raw = timeLeftLabel(iso);
    if (!raw) return null;
    return raw === 'expiring now' ? t('expiringNow') : t('minLeft', { n: raw.split(' ')[0] });
  };
  const timeLeft = leftLabel(ride.consentExpiresAt);
  const names = (list) => list.join(', ');

  const payLine = (() => {
    if (ride.status === 'COMPLETED') {
      if (ride.paid_with === 'TESLAPAY') return t('paidWithTeslaPay');
      if (ride.paid_with === 'CASH') return ride.payment_method === 'TESLAPAY' ? t('walletShortCash') : t('payDriverCash');
      return null;
    }
    if (ride.status === 'CANCELLED') return null;
    return ride.payment_method === 'TESLAPAY' ? t('paysWithTeslaPay') : null;
  })();

  async function shareTrip() {
    setBusy(true);
    setNote(null);
    try {
      const { path } = await api.createShare(token, ride.id);
      const base = (process.env.EXPO_PUBLIC_WEB_URL || '').replace(/\/+$/, '');
      await Share.share({ message: t('shareMessage', { url: `${base}${path}` }) });
    } catch (err) {
      setNote(err instanceof ApiRequestError ? err.message : t('shareFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function stopSharing() {
    setBusy(true);
    try {
      await api.revokeShare(token, ride.id);
    } catch {
      /* already gone */
    } finally {
      setBusy(false);
    }
  }

  async function submitRating() {
    setBusy(true);
    setNote(null);
    try {
      await api.rateRide(token, ride.id, stars);
      setRated(true);
      onChanged?.();
    } catch (err) {
      setNote(err instanceof ApiRequestError ? err.message : t('genericError'));
    } finally {
      setBusy(false);
    }
  }

  const trip = ride.trip;
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>
            {ride.pickup_zone_name} → {ride.destination_zone_name}
          </Text>
          {ride.pickup_point_name ? <Text style={{ color: colors.muted, fontSize: 12 }}>{ride.pickup_point_name}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            <StatusBadge status={ride.status} />
            <Text style={{ color: colors.muted, fontSize: 13 }}>{tn('seat', ride.seats_requested)}</Text>
            {ride.women_only ? <Tag text={t('womenOnly')} tone="warn" /> : null}
          </View>
          {ride.scheduled_for && ride.status === 'REQUESTED' ? (
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
              {t('scheduledFor', { time: new Date(ride.scheduled_for).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}
            </Text>
          ) : null}
          {showPoolmates && <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>{t('sharingWith', { names: names(poolmates.map((m) => m.name)) })}</Text>}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{money(ride.final_fare_paisa)}</Text>
          {ride.status === 'REQUESTED' && <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'right' }}>{t('estimateNote', { pct: POOL_DISCOUNT_DISPLAY_PERCENT })}</Text>}
          {payLine && <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'right' }}>{payLine}</Text>}
          {canCancel && !awaitingAgreement && (
            <View style={{ marginTop: 8 }}>
              <LinkButton title={t('cancel')} onPress={() => onCancel(ride.id)} disabled={cancelling} />
            </View>
          )}
        </View>
      </View>

      {/* Who is coming, and how far away they are. */}
      {trip && (
        <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 }}>
          <Text style={{ color: colors.ink, fontSize: 14 }}>
            {t('driverLabel')}: <Text style={{ fontWeight: '700' }}>{trip.driverName}</Text> · {trip.teslaName}
            {trip.vehiclePlate ? ` · ${trip.vehiclePlate}` : ''}
          </Text>
          {trip.driverRating?.count > 0 && <Text style={{ color: colors.amber, fontSize: 13 }}>★ {num(trip.driverRating.average)} ({num(trip.driverRating.count)})</Text>}
          {trip.etaMinutes ? (
            <Text style={{ color: colors.transit, fontSize: 14, fontWeight: '600', marginTop: 4 }}>
              {t('etaAbout', { n: trip.etaMinutes })} <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '400' }}>· {t('etaNote')}</Text>
            </Text>
          ) : null}
        </View>
      )}

      {/* You're the newcomer: everyone in the pool, you included, has to agree. */}
      {awaitingAgreement && (
        <View style={box}>
          <Text style={{ color: colors.ink, fontSize: 14 }}>
            {poolmates.length > 0
              ? t('consentJoiner', { names: names(poolmates.map((m) => m.name)), places: names(poolmates.map((m) => m.destination)) })
              : t('consentJoinerNoNames')}{' '}
            {t('consentTail')}
            {timeLeft ? ` ${t('answerInTime', { left: timeLeft })}` : ''}
          </Text>
          {ride.ownConsentPending ? (
            <View style={{ marginTop: 10, gap: 8 }}>
              <Button title={t('confirmSharing')} onPress={() => onConfirm(ride.id)} loading={confirming} />
              <Button title={t('dontShare')} variant="secondary" onPress={() => onDecline(ride.id)} loading={declining} />
              <View style={{ alignItems: 'center', marginTop: 4 }}>
                <LinkButton title={t('cancelRideEntirely')} onPress={() => onCancel(ride.id)} disabled={cancelling} />
              </View>
            </View>
          ) : (
            <Text style={{ marginTop: 8, color: colors.ink, fontSize: 14 }}>
              {t('youAgreed')}
              {waitingOn.length > 0 ? ` ${t('waitingFor', { names: names(waitingOn) })}` : ''}
            </Text>
          )}
        </View>
      )}

      {/* You're already in the pool: a newcomer is being proposed, and you get a say. */}
      {pendingConsents.map((q) => {
        const left = leftLabel(q.expiresAt);
        return (
          <View key={q.id} style={box}>
            <Text style={{ color: colors.ink, fontSize: 14 }}>
              {t('proposedToShare', { name: q.joinerName, pickup: q.joinerPickup, dest: q.joinerDestination })}
              {left ? ` (${left})` : ''}
            </Text>
            <View style={{ marginTop: 10, gap: 8 }}>
              <Button title={t('yesShare')} onPress={() => onApproveConsent(q.id)} loading={answeringConsentId === q.id} />
              <Button title={t('noKeepMine')} variant="secondary" onPress={() => onRejectConsent(q.id)} disabled={answeringConsentId === q.id} />
            </View>
          </View>
        );
      })}

      {/* Safety: let someone you trust follow the trip. */}
      {FOLLOWABLE.has(ride.status) && ride.status !== 'REQUESTED' && (
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 12 }}>
          <LinkButton title={t('shareTrip')} onPress={shareTrip} disabled={busy} />
          <LinkButton title={t('stopSharing')} onPress={stopSharing} disabled={busy} />
        </View>
      )}

      {/* After the ride: the receipt, and a rating. */}
      {(ride.status === 'COMPLETED' || ride.payment_kind === 'NO_SHOW_FEE') && (
        <View style={{ marginTop: 12 }}>
          <LinkButton title={t('receipt')} onPress={() => setReceiptOpen(true)} />
        </View>
      )}
      {ride.status === 'COMPLETED' && !rated && (
        <View style={{ marginTop: 12, gap: 8 }}>
          <Text style={{ color: colors.ink, fontSize: 14 }}>{t('rateDriver')}</Text>
          <Stars value={stars} onChange={setStars} />
          {stars > 0 && <Button title={t('submitRating')} onPress={submitRating} loading={busy} style={{ minHeight: 40 }} />}
        </View>
      )}
      {ride.status === 'COMPLETED' && rated && <Text style={{ color: colors.muted, fontSize: 13, marginTop: 10 }}>{t('thanksRating')}</Text>}
      <Banner text={note} />

      <ReceiptModal visible={receiptOpen} token={token} rideId={ride.id} onClose={() => setReceiptOpen(false)} />
    </Card>
  );
}
