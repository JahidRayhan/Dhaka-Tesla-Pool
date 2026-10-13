import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Banner, Button, Card, Field, Heading, Muted } from '../../components/ui';
import PoolCard from '../../components/PoolCard';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { formatTaka } from '../../lib/format';
import { usePolling } from '../../lib/usePolling';
import { colors } from '../../lib/theme';

export default function DriverScreen() {
  const { token, logout } = useAuth();

  const [tesla, setTesla] = useState(undefined); // undefined = loading, null = none registered
  const [teslaForm, setTeslaForm] = useState({ name: '', capacity: '3' });
  const [togglingActive, setTogglingActive] = useState(false);

  const [openRequests, setOpenRequests] = useState([]);
  const [activePool, setActivePool] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [acceptingId, setAcceptingId] = useState(null);
  const [advancing, setAdvancing] = useState(false);
  const [cancellingPool, setCancellingPool] = useState(false);

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

  const loadTesla = useCallback(async () => {
    try {
      const data = await api.myTeslas(token);
      setTesla(data.teslas[0] || null);
    } catch (err) {
      setTesla((current) => (current === undefined ? null : current));
      const message = handleError(err, 'Could not load your Tesla.');
      if (message) setLoadError(message);
    }
  }, [token, handleError]);

  useEffect(() => {
    loadTesla();
  }, [loadTesla]);

  const loadBoard = useCallback(async () => {
    if (!tesla) return;
    try {
      const [openData, poolsData] = await Promise.all([api.openRideRequests(token), api.myPools(token)]);
      setOpenRequests(openData.rideRequests);
      const mine = poolsData.pools[0];
      if (mine) {
        const detail = await api.poolDetail(token, mine.id);
        setActivePool(detail.pool);
      } else {
        setActivePool(null);
      }
      setLoadError(null);
    } catch (err) {
      const message = handleError(err, 'Could not load the board.');
      if (message) setLoadError(message);
    }
  }, [token, tesla, handleError]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  // Poll while online so new requests and pool changes appear without a manual refresh.
  usePolling(loadBoard, 4000, !!tesla?.is_active);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadTesla(), loadBoard()]);
    setRefreshing(false);
  }

  async function registerTesla() {
    setLoadError(null);
    try {
      await api.createTesla(token, { name: teslaForm.name.trim(), capacity: Number(teslaForm.capacity) });
      await loadTesla();
    } catch (err) {
      const message = handleError(err, 'Could not register the Tesla.');
      if (message) setLoadError(message);
    }
  }

  async function toggleActive() {
    setTogglingActive(true);
    try {
      await api.setTeslaActive(token, tesla.id, !tesla.is_active);
      await loadTesla();
    } catch (err) {
      const message = handleError(err, 'Could not update status.');
      if (message) setLoadError(message);
    } finally {
      setTogglingActive(false);
    }
  }

  async function accept(requestId) {
    setAcceptingId(requestId);
    setActionError(null);
    try {
      // A Tesla can only run one active pool at a time — join it if one exists,
      // otherwise start a new one.
      await api.acceptRideRequest(token, requestId, { teslaId: tesla.id, poolId: activePool ? activePool.id : undefined });
      await loadBoard();
    } catch (err) {
      const message = handleError(err, 'Could not accept that request.');
      if (message) setActionError(message);
    } finally {
      setAcceptingId(null);
    }
  }

  async function advance(poolId, action) {
    setAdvancing(true);
    setActionError(null);
    try {
      if (action === 'arrive') await api.arrivePool(token, poolId);
      if (action === 'start') await api.startPool(token, poolId);
      if (action === 'complete') await api.completePool(token, poolId);
      await loadBoard();
    } catch (err) {
      const message = handleError(err, 'Could not update the trip.');
      if (message) setActionError(message);
      await loadBoard();
    } finally {
      setAdvancing(false);
    }
  }

  async function cancelPool(poolId) {
    setCancellingPool(true);
    setActionError(null);
    try {
      await api.cancelPool(token, poolId);
      await loadBoard();
    } catch (err) {
      const message = handleError(err, 'Could not cancel the pool.');
      if (message) setActionError(message);
      await loadBoard();
    } finally {
      setCancellingPool(false);
    }
  }

  if (tesla === undefined) {
    return (
      <View style={{ flex: 1, padding: 24, backgroundColor: colors.bg }}>
        <Banner text={loadError} />
        <Muted>Loading…</Muted>
      </View>
    );
  }

  if (!tesla) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
        <Heading>Register your Tesla</Heading>
        <Muted style={{ marginBottom: 16 }}>Jashim's is seeded as "Bullet" — this form is for new drivers.</Muted>
        <Field label="Name" value={teslaForm.name} onChangeText={(v) => setTeslaForm((f) => ({ ...f, name: v }))} placeholder="e.g. Bullet" autoCapitalize="words" />
        <Field label="Seats (1–6)" value={teslaForm.capacity} onChangeText={(v) => setTeslaForm((f) => ({ ...f, capacity: v.replace(/[^0-9]/g, '') }))} keyboardType="number-pad" />
        <Banner text={loadError} />
        <Button title="Register" onPress={registerTesla} disabled={!teslaForm.name.trim() || !teslaForm.capacity} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{tesla.name}</Text>
          <Muted>{tesla.capacity} seats</Muted>
        </View>
        <Button
          title={tesla.is_active ? '● Online' : 'Go online'}
          variant={tesla.is_active ? 'secondary' : 'primary'}
          onPress={toggleActive}
          loading={togglingActive}
        />
      </Card>

      <Banner text={actionError} />
      <Banner text={loadError} />

      {activePool && (
        <>
          <Heading style={{ marginTop: 8 }}>Active pool</Heading>
          <PoolCard pool={activePool} onAdvance={advance} advancing={advancing} onCancel={cancelPool} cancelling={cancellingPool} />
        </>
      )}

      <Heading style={{ marginTop: 8 }}>Open requests</Heading>
      {!tesla.is_active ? (
        <Muted>Go online to see requests.</Muted>
      ) : openRequests.length === 0 ? (
        <Muted>No open requests right now.</Muted>
      ) : (
        openRequests.map((r) => (
          <Card key={r.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{r.passenger_name || 'Passenger'}</Text>
              <Muted>
                {r.pickup_zone_name} → {r.destination_zone_name} · {r.seats_requested} seat{r.seats_requested > 1 ? 's' : ''}
              </Muted>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 8 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{formatTaka(r.final_fare_paisa)}</Text>
              <Button
                title={activePool ? 'Add to pool' : 'Accept'}
                onPress={() => accept(r.id)}
                loading={acceptingId === r.id}
                style={{ minHeight: 40 }}
              />
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}
