import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Banner, Button, Card, Chip, Heading, LinkButton, Muted, ToggleRow } from '../../components/ui';
import RideCard from '../../components/RideCard';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { useI18n } from '../../lib/LanguageContext';
import { usePolling } from '../../lib/usePolling';
import { colors } from '../../lib/theme';

const ACTIVE_STATUSES = new Set(['REQUESTED', 'PENDING_CONFIRMATION', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED']);
const TOP_UP_PAISA = 50000; // ৳500 per tap — simulated money
const MAX_SEATS = 3;
const WHEN = [['now', 'now', 0], ['in30', 'in30', 30], ['in60', 'in60', 60], ['in120', 'in120', 120]];
const WAITS = [[null, 'min60'], [15, 'min15'], [30, 'min30'], [120, 'min120']];

export default function PassengerScreen() {
  const { token, user, logout } = useAuth();
  const { t, tn, money, num } = useI18n();
  const router = useRouter();

  const [zones, setZones] = useState([]);
  const [rides, setRides] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [loadingRides, setLoadingRides] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [pickupZoneId, setPickupZoneId] = useState(null);
  const [destinationZoneId, setDestinationZoneId] = useState(null);
  const [seats, setSeats] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [showMore, setShowMore] = useState(false);
  const [whenKey, setWhenKey] = useState('now');
  const [maxWait, setMaxWait] = useState(null);
  const [shareMax, setShareMax] = useState(null);
  const [womenOnly, setWomenOnly] = useState(false);
  const [points, setPoints] = useState([]);
  const [pickupPointId, setPickupPointId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [toppingUp, setToppingUp] = useState(false);
  const [formError, setFormError] = useState(null);

  const [busyId, setBusyId] = useState(null);
  const [answeringConsentId, setAnsweringConsentId] = useState(null);

  // A 401 that survives the silent token refresh means the session is really over.
  const handleError = useCallback(
    (err, fallback) => {
      if (err instanceof ApiRequestError && err.status === 401) {
        logout();
        return null;
      }
      return err instanceof ApiRequestError ? err.message : fallback;
    },
    [logout],
  );

  const loadWallet = useCallback(async () => {
    try {
      setWallet(await api.wallet(token));
    } catch {
      // keep the last known balance; it must never hide the rides
    }
  }, [token]);

  const loadRides = useCallback(async () => {
    try {
      const data = await api.myRideRequests(token);
      setRides(data.rideRequests);
      setLoadError(null);
      loadWallet(); // the balance changes when a TeslaPay ride completes
    } catch (err) {
      const message = handleError(err, t('genericError'));
      if (message) setLoadError(message);
    } finally {
      setLoadingRides(false);
    }
  }, [token, loadWallet, handleError, t]);

  useEffect(() => {
    api.zones().then((data) => {
      setZones(data.zones);
      if (data.zones.length > 1) {
        setPickupZoneId(data.zones[0].id);
        setDestinationZoneId(data.zones[1].id);
      }
    }).catch((err) => {
      const message = handleError(err, t('genericError'));
      if (message) setFormError(message);
    });
    loadRides();
  }, [loadRides, handleError, t]);

  // Meeting points belong to the pickup zone; changing the zone clears the choice.
  useEffect(() => {
    setPickupPointId(null);
    setPoints([]);
    if (!pickupZoneId) return;
    api.meetingPoints(pickupZoneId).then((d) => setPoints(d.meetingPoints)).catch(() => {});
  }, [pickupZoneId]);

  usePolling(loadRides, 5000, rides.some((r) => ACTIVE_STATUSES.has(r.status)));

  async function onRefresh() {
    setRefreshing(true);
    await loadRides();
    setRefreshing(false);
  }

  async function requestRide() {
    setFormError(null);
    if (pickupZoneId === destinationZoneId) {
      setFormError(t('samePlaceError'));
      return;
    }
    const minutes = WHEN.find(([k]) => k === whenKey)[2];
    setSubmitting(true);
    try {
      await api.createRideRequest(token, {
        pickupZoneId,
        destinationZoneId,
        seatsRequested: seats,
        paymentMethod,
        ...(minutes > 0 && { scheduledFor: new Date(Date.now() + minutes * 60000).toISOString() }),
        ...(maxWait && { maxWaitMinutes: maxWait }),
        ...(shareMax && { shareMax }),
        ...(womenOnly && { womenOnly: true }),
        ...(pickupPointId && { pickupPointId }),
      });
      await loadRides();
    } catch (err) {
      const message = handleError(err, t('genericError'));
      if (message) setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function topUp() {
    setToppingUp(true);
    setFormError(null);
    try {
      await api.topUpWallet(token, TOP_UP_PAISA);
      await loadWallet();
    } catch (err) {
      const message = handleError(err, t('topUpUnavailable'));
      if (message) setFormError(message);
    } finally {
      setToppingUp(false);
    }
  }

  const rideAction = (fn) => async (id) => {
    setBusyId(id);
    try {
      await fn(id);
      await loadRides();
    } catch (err) {
      const message = handleError(err, t('genericError'));
      if (message) setLoadError(message);
    } finally {
      setBusyId(null);
    }
  };
  const cancelRide = rideAction((id) => api.cancelRideRequest(token, id));
  const confirmRide = rideAction((id) => api.confirmRideRequest(token, id));
  const declineRide = rideAction((id) => api.declineRideRequest(token, id));

  async function answerConsent(consentId, approve) {
    setAnsweringConsentId(consentId);
    try {
      if (approve) await api.approvePoolConsent(token, consentId);
      else await api.rejectPoolConsent(token, consentId);
    } catch (err) {
      const message = handleError(err, t('genericError'));
      if (message) setLoadError(message);
    } finally {
      await loadRides(); // the proposal may have timed out — always show the current truth
      setAnsweringConsentId(null);
    }
  }

  const zoneChips = (selectedId, onSelect) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {zones.map((z) => <Chip key={z.id} label={z.name} selected={selectedId === z.id} onPress={() => onSelect(z.id)} />)}
    </ScrollView>
  );
  const chipRow = (children) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>{children}</View>;
  const pickupZone = zones.find((z) => z.id === pickupZoneId);
  const canWomenOnly = user?.gender === 'female';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      keyboardShouldPersistTaps="handled"
    >
      <Heading>{t('requestRide')}</Heading>
      <Card>
        <Muted style={{ marginBottom: 6 }}>{t('pickup')}</Muted>
        {zoneChips(pickupZoneId, setPickupZoneId)}
        <Muted style={{ marginTop: 14, marginBottom: 6 }}>{t('dropoff')}</Muted>
        {zoneChips(destinationZoneId, setDestinationZoneId)}

        <Muted style={{ marginTop: 14, marginBottom: 6 }}>{t('seats')}</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Button title="−" variant="secondary" style={{ width: 46, paddingHorizontal: 0 }} onPress={() => setSeats((s) => Math.max(1, s - 1))} />
          <Text style={{ fontSize: 18, fontWeight: '600', color: colors.ink, minWidth: 16, textAlign: 'center' }}>{num(seats)}</Text>
          <Button title="+" variant="secondary" style={{ width: 46, paddingHorizontal: 0 }} onPress={() => setSeats((s) => Math.min(MAX_SEATS, s + 1))} />
        </View>

        <Muted style={{ marginTop: 14, marginBottom: 6 }}>{t('payWith')}</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', rowGap: 8 }}>
          <Chip label={t('cash')} selected={paymentMethod === 'CASH'} onPress={() => setPaymentMethod('CASH')} />
          <Chip label={t('teslaPay')} selected={paymentMethod === 'TESLAPAY'} onPress={() => setPaymentMethod('TESLAPAY')} />
          {wallet && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Muted>{t('wallet')} {money(wallet.balancePaisa)}</Muted>
              <LinkButton title={toppingUp ? t('adding') : `${t('add')} ${money(TOP_UP_PAISA)}`} onPress={topUp} disabled={toppingUp} />
            </View>
          )}
        </View>

        <View style={{ marginTop: 12 }}>
          <LinkButton title={showMore ? t('fewerOptions') : t('moreOptions')} onPress={() => setShowMore((v) => !v)} />
        </View>

        {showMore && (
          <View>
            <Muted style={{ marginTop: 14, marginBottom: 6 }}>{t('when')}</Muted>
            {chipRow(WHEN.map(([k, label]) => <Chip key={k} label={t(label)} selected={whenKey === k} onPress={() => setWhenKey(k)} />))}

            <Muted style={{ marginTop: 14, marginBottom: 6 }}>{t('waitUpTo')}</Muted>
            {chipRow(WAITS.map(([v, label]) => <Chip key={label} label={t(label)} selected={maxWait === v} onPress={() => setMaxWait(v)} />))}

            <Muted style={{ marginTop: 14, marginBottom: 6 }}>{t('sharing')}</Muted>
            {chipRow([
              <Chip key="ask" label={t('askEachTime')} selected={shareMax === null} onPress={() => setShareMax(null)} />,
              <Chip key="2" label={t('upTo2')} selected={shareMax === 2} onPress={() => setShareMax(2)} />,
              <Chip key="3" label={t('upTo3')} selected={shareMax === 3} onPress={() => setShareMax(3)} />,
            ])}
            <Muted style={{ marginTop: 4, fontSize: 12 }}>{t('sharingHelp')}</Muted>

            <ToggleRow
              label={t('womenOnly')}
              help={canWomenOnly ? t('womenOnlyHelp') : t('womenOnlyNeedsGender')}
              value={womenOnly && canWomenOnly}
              onValueChange={setWomenOnly}
              disabled={!canWomenOnly}
            />
            {!canWomenOnly && (
              <View style={{ marginTop: 4 }}>
                <LinkButton title={t('account')} onPress={() => router.push('/account')} />
              </View>
            )}

            {points.length > 0 && (
              <>
                <Muted style={{ marginTop: 14, marginBottom: 6 }}>{t('meetingPoint')}</Muted>
                {chipRow([
                  <Chip key="any" label={t('anywhereIn', { zone: pickupZone?.name ?? '' })} selected={pickupPointId === null} onPress={() => setPickupPointId(null)} />,
                  ...points.map((p) => <Chip key={p.id} label={p.name.split('—').pop().trim()} selected={pickupPointId === p.id} onPress={() => setPickupPointId(p.id)} />),
                ])}
              </>
            )}
          </View>
        )}

        <View style={{ marginTop: 16 }}>
          <Banner text={formError} />
          <Button title={t('requestTesla')} onPress={requestRide} loading={submitting} disabled={zones.length === 0} />
        </View>
      </Card>

      <Heading style={{ marginTop: 12 }}>{t('yourRides')}</Heading>
      <Banner text={loadError} />
      {loadingRides ? (
        <Muted>{t('loading')}</Muted>
      ) : rides.length === 0 ? (
        <Muted>{t('noRides')}</Muted>
      ) : (
        rides.map((r) => (
          <RideCard
            key={r.id}
            ride={r}
            token={token}
            onChanged={loadRides}
            onCancel={cancelRide}
            cancelling={busyId === r.id}
            onConfirm={confirmRide}
            confirming={busyId === r.id}
            onDecline={declineRide}
            declining={busyId === r.id}
            onApproveConsent={(id) => answerConsent(id, true)}
            onRejectConsent={(id) => answerConsent(id, false)}
            answeringConsentId={answeringConsentId}
          />
        ))
      )}
    </ScrollView>
  );
}
