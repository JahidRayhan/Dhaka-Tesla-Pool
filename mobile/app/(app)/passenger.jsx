import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Banner, Button, Card, Chip, Heading, LinkButton, Muted } from '../../components/ui';
import RideCard from '../../components/RideCard';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { formatTaka } from '../../lib/format';
import { usePolling } from '../../lib/usePolling';
import { colors } from '../../lib/theme';

const ACTIVE_STATUSES = new Set(['REQUESTED', 'PENDING_CONFIRMATION', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED']);
const TOP_UP_PAISA = 50000; // ৳500 per tap — simulated money
const MAX_SEATS = 3;

export default function PassengerScreen() {
  const { token, logout } = useAuth();

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
  const [submitting, setSubmitting] = useState(false);
  const [toppingUp, setToppingUp] = useState(false);
  const [formError, setFormError] = useState(null);

  const [busyId, setBusyId] = useState(null); // ride being cancelled/confirmed/declined
  const [answeringConsentId, setAnsweringConsentId] = useState(null);

  // A 401 mid-session means the token expired: sign out rather than show errors forever.
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

  // Best-effort: a failed balance fetch must never hide the rides.
  const loadWallet = useCallback(async () => {
    try {
      setWallet(await api.wallet(token));
    } catch {
      // keep the last known balance
    }
  }, [token]);

  const loadRides = useCallback(async () => {
    try {
      const data = await api.myRideRequests(token);
      setRides(data.rideRequests);
      setLoadError(null);
      loadWallet(); // the balance changes when a TeslaPay ride completes
    } catch (err) {
      const message = handleError(err, 'Could not load your rides.');
      if (message) setLoadError(message);
    } finally {
      setLoadingRides(false);
    }
  }, [token, loadWallet, handleError]);

  useEffect(() => {
    api
      .zones()
      .then((data) => {
        setZones(data.zones);
        if (data.zones.length > 1) {
          setPickupZoneId(data.zones[0].id);
          setDestinationZoneId(data.zones[1].id);
        }
      })
      .catch((err) => {
        const message = handleError(err, 'Could not load the areas.');
        if (message) setFormError(message);
      });
    loadRides();
  }, [loadRides, handleError]);

  // Poll while any ride is in a non-terminal state — same rule as the web app.
  usePolling(loadRides, 5000, rides.some((r) => ACTIVE_STATUSES.has(r.status)));

  async function onRefresh() {
    setRefreshing(true);
    await loadRides();
    setRefreshing(false);
  }

  async function requestRide() {
    setFormError(null);
    if (pickupZoneId === destinationZoneId) {
      setFormError('Pickup and destination must be different areas.');
      return;
    }
    setSubmitting(true);
    try {
      await api.createRideRequest(token, { pickupZoneId, destinationZoneId, seatsRequested: seats, paymentMethod });
      await loadRides();
    } catch (err) {
      const message = handleError(err, 'Could not request a ride.');
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
      const message = handleError(err, 'Could not add money to your wallet.');
      if (message) setFormError(message);
    } finally {
      setToppingUp(false);
    }
  }

  // One wrapper for every "do something to a ride, then refresh" action.
  const rideAction = (fn, fallback) => async (id) => {
    setBusyId(id);
    try {
      await fn(id);
      await loadRides();
    } catch (err) {
      const message = handleError(err, fallback);
      if (message) setLoadError(message);
    } finally {
      setBusyId(null);
    }
  };
  const cancelRide = rideAction((id) => api.cancelRideRequest(token, id), 'Could not cancel that ride.');
  const confirmRide = rideAction((id) => api.confirmRideRequest(token, id), 'Could not confirm sharing that ride.');
  const declineRide = rideAction((id) => api.declineRideRequest(token, id), 'Could not decline sharing that ride.');

  async function answerConsent(consentId, approve) {
    setAnsweringConsentId(consentId);
    try {
      if (approve) await api.approvePoolConsent(token, consentId);
      else await api.rejectPoolConsent(token, consentId);
      await loadRides();
    } catch (err) {
      const message = handleError(err, 'Could not send your answer.');
      if (message) setLoadError(message);
      await loadRides(); // the proposal may have timed out — show the current truth
    } finally {
      setAnsweringConsentId(null);
    }
  }

  const zoneChips = (selectedId, onSelect) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {zones.map((z) => (
        <Chip key={z.id} label={z.name} selected={selectedId === z.id} onPress={() => onSelect(z.id)} />
      ))}
    </ScrollView>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      keyboardShouldPersistTaps="handled"
    >
      <Heading>Request a ride</Heading>
      <Card>
        <Muted style={{ marginBottom: 6 }}>Pickup</Muted>
        {zoneChips(pickupZoneId, setPickupZoneId)}
        <Muted style={{ marginTop: 14, marginBottom: 6 }}>Drop-off</Muted>
        {zoneChips(destinationZoneId, setDestinationZoneId)}

        <Muted style={{ marginTop: 14, marginBottom: 6 }}>Seats</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Button title="−" variant="secondary" style={{ width: 46, paddingHorizontal: 0 }} onPress={() => setSeats((s) => Math.max(1, s - 1))} />
          <Text style={{ fontSize: 18, fontWeight: '600', color: colors.ink, minWidth: 16, textAlign: 'center' }}>{seats}</Text>
          <Button title="+" variant="secondary" style={{ width: 46, paddingHorizontal: 0 }} onPress={() => setSeats((s) => Math.min(MAX_SEATS, s + 1))} />
        </View>

        <Muted style={{ marginTop: 14, marginBottom: 6 }}>Pay with</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', rowGap: 8 }}>
          <Chip label="Cash" selected={paymentMethod === 'CASH'} onPress={() => setPaymentMethod('CASH')} />
          <Chip label="TeslaPay" selected={paymentMethod === 'TESLAPAY'} onPress={() => setPaymentMethod('TESLAPAY')} />
          {wallet && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Muted>Wallet {formatTaka(wallet.balancePaisa)}</Muted>
              <LinkButton title={toppingUp ? 'Adding…' : `Add ${formatTaka(TOP_UP_PAISA)}`} onPress={topUp} disabled={toppingUp} />
            </View>
          )}
        </View>

        <View style={{ marginTop: 16 }}>
          <Banner text={formError} />
          <Button title="Request a Tesla" onPress={requestRide} loading={submitting} disabled={zones.length === 0} />
        </View>
      </Card>

      <Heading style={{ marginTop: 12 }}>Your rides</Heading>
      <Banner text={loadError} />
      {loadingRides ? (
        <Muted>Loading…</Muted>
      ) : rides.length === 0 ? (
        <Muted>No rides yet — request one above to get started.</Muted>
      ) : (
        rides.map((r) => (
          <RideCard
            key={r.id}
            ride={r}
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
