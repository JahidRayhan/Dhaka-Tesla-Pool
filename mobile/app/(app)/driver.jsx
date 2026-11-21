import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Banner, Button, Card, Field, Heading, Muted, Tag, ToggleRow } from '../../components/ui';
import PoolCard from '../../components/PoolCard';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { useI18n } from '../../lib/LanguageContext';
import { useLocationSharing } from '../../lib/useLocationSharing';
import { usePolling } from '../../lib/usePolling';
import { colors } from '../../lib/theme';

const LIVE = new Set(['MATCHED', 'DRIVER_ARRIVED', 'STARTED']);
const VERIFY_TONE = { VERIFIED: 'good', PENDING: 'warn', REJECTED: 'bad', NONE: 'muted' };

export default function DriverScreen() {
  const { token, logout } = useAuth();
  const { t, tn, money, num } = useI18n();

  const [tesla, setTesla] = useState(undefined); // undefined = loading, null = none registered
  const [teslaForm, setTeslaForm] = useState({ name: '', capacity: '3' });
  const [togglingActive, setTogglingActive] = useState(false);

  const [profile, setProfile] = useState(undefined);
  const [profileForm, setProfileForm] = useState({ licenseNumber: '', vehiclePlate: '' });
  const [earnings, setEarnings] = useState(null);

  const [openRequests, setOpenRequests] = useState([]);
  const [activePool, setActivePool] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [acceptingId, setAcceptingId] = useState(null);
  const [advancing, setAdvancing] = useState(false);
  const [cancellingPool, setCancellingPool] = useState(false);
  const [shareLocation, setShareLocation] = useState(true);

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
      const message = handleError(err, t('genericError'));
      if (message) setLoadError(message);
    }
  }, [token, handleError, t]);

  const loadProfile = useCallback(async () => {
    try {
      const data = await api.driverProfile(token);
      setProfile(data.profile);
      if (data.profile) setProfileForm({ licenseNumber: data.profile.license_number, vehiclePlate: data.profile.vehicle_plate });
    } catch {
      setProfile((p) => (p === undefined ? null : p));
    }
  }, [token]);

  const loadEarnings = useCallback(async () => {
    try {
      setEarnings((await api.earnings(token)).totals);
    } catch {
      // the board matters more than the summary
    }
  }, [token]);

  useEffect(() => {
    loadTesla();
    loadProfile();
    loadEarnings();
  }, [loadTesla, loadProfile, loadEarnings]);

  const loadBoard = useCallback(async () => {
    if (!tesla) return;
    try {
      const poolsData = await api.myPools(token);
      const mine = poolsData.pools[0];
      let pool = null;
      if (mine) pool = (await api.poolDetail(token, mine.id)).pool;
      setActivePool(pool);
      // With a live pool, ask the server which open requests could actually join it.
      const openData = await api.openRideRequests(token, pool && pool.status === 'MATCHED' ? pool.id : undefined);
      setOpenRequests(openData.rideRequests);
      setLoadError(null);
    } catch (err) {
      const message = handleError(err, t('genericError'));
      if (message) setLoadError(message);
    }
  }, [token, tesla, handleError, t]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  usePolling(loadBoard, 4000, !!tesla?.is_active);

  useLocationSharing({
    enabled: shareLocation && !!activePool && LIVE.has(activePool.status),
    poolId: activePool?.id,
    token,
    onDenied: () => setActionError(t('locationDenied')),
  });

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([loadTesla(), loadBoard(), loadProfile(), loadEarnings()]);
    setRefreshing(false);
  }

  async function run(fn, { setBusy, after } = {}) {
    setBusy?.(true);
    setActionError(null);
    try {
      await fn();
      if (after) await after();
    } catch (err) {
      const message = handleError(err, t('genericError'));
      if (message) setActionError(message);
      await loadBoard();
    } finally {
      setBusy?.(false);
    }
  }

  const registerTesla = () => run(async () => { await api.createTesla(token, { name: teslaForm.name.trim(), capacity: Number(teslaForm.capacity) }); await loadTesla(); });
  const toggleActive = () => run(async () => { await api.setTeslaActive(token, tesla.id, !tesla.is_active); await loadTesla(); }, { setBusy: setTogglingActive });
  const submitProfile = () => run(async () => { await api.submitDriverProfile(token, { licenseNumber: profileForm.licenseNumber.trim(), vehiclePlate: profileForm.vehiclePlate.trim() }); await loadProfile(); });
  const accept = (requestId) =>
    run(() => api.acceptRideRequest(token, requestId, { teslaId: tesla.id, poolId: activePool ? activePool.id : undefined }), {
      setBusy: (b) => setAcceptingId(b ? requestId : null),
      after: loadBoard,
    });
  const advance = (poolId, action) =>
    run(async () => {
      if (action === 'arrive') await api.arrivePool(token, poolId);
      if (action === 'start') await api.startPool(token, poolId);
      if (action === 'complete') await api.completePool(token, poolId);
    }, { setBusy: setAdvancing, after: async () => { await loadBoard(); if (action === 'complete') loadEarnings(); } });
  const cancelPool = (poolId) => run(() => api.cancelPool(token, poolId), { setBusy: setCancellingPool, after: loadBoard });
  const noShow = (poolId, requestId) => run(() => api.markNoShow(token, poolId, requestId), { after: async () => { await loadBoard(); loadEarnings(); } });

  if (tesla === undefined) {
    return (
      <View style={{ flex: 1, padding: 24, backgroundColor: colors.bg }}>
        <Banner text={loadError} />
        <Muted>{t('loading')}</Muted>
      </View>
    );
  }

  if (!tesla) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
        <Heading>{t('registerTesla')}</Heading>
        <Field label={t('teslaName')} value={teslaForm.name} onChangeText={(v) => setTeslaForm((f) => ({ ...f, name: v }))} placeholder="Bullet" autoCapitalize="words" />
        <Field label={t('teslaSeats')} value={teslaForm.capacity} onChangeText={(v) => setTeslaForm((f) => ({ ...f, capacity: v.replace(/[^0-9]/g, '') }))} keyboardType="number-pad" />
        <Banner text={actionError || loadError} />
        <Button title={t('register')} onPress={registerTesla} disabled={!teslaForm.name.trim() || !teslaForm.capacity} />
      </ScrollView>
    );
  }

  const vStatus = profile ? profile.status : 'NONE';
  const reasonOf = (r) => (r.fit && !r.fit.fits ? t(`whyNot_${r.fit.reason}`) : null);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      keyboardShouldPersistTaps="handled"
    >
      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{tesla.name}</Text>
          <Muted>{tn('seat', tesla.capacity)}</Muted>
        </View>
        <Button title={tesla.is_active ? t('online') : t('goOnline')} variant={tesla.is_active ? 'secondary' : 'primary'} onPress={toggleActive} loading={togglingActive} />
      </Card>

      <Banner text={actionError} />
      <Banner text={loadError} />

      {/* Credentials riders can trust (an admin approves them). */}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{t('verification')}</Text>
          <Tag text={t(`v_${vStatus}`)} tone={VERIFY_TONE[vStatus]} />
        </View>
        {vStatus === 'REJECTED' && profile?.review_note ? <Muted style={{ marginTop: 6 }}>{profile.review_note}</Muted> : null}
        {vStatus !== 'VERIFIED' && (
          <View style={{ marginTop: 10 }}>
            {vStatus === 'NONE' && <Muted style={{ marginBottom: 10 }}>{t('verifyIntro')}</Muted>}
            <Field label={t('licenseNumber')} value={profileForm.licenseNumber} onChangeText={(v) => setProfileForm((f) => ({ ...f, licenseNumber: v }))} autoCapitalize="characters" />
            <Field label={t('vehiclePlate')} value={profileForm.vehiclePlate} onChangeText={(v) => setProfileForm((f) => ({ ...f, vehiclePlate: v }))} autoCapitalize="characters" />
            <Button title={t('submitForReview')} onPress={submitProfile} disabled={profileForm.licenseNumber.trim().length < 3 || profileForm.vehiclePlate.trim().length < 3} />
          </View>
        )}
      </Card>

      {earnings && (
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 6 }}>{t('earnings')}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Muted>{t('ridesDone')}</Muted><Text style={{ color: colors.ink }}>{num(earnings.ridesCompleted)}</Text></View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Muted>{t('walletPaid')}</Muted><Text style={{ color: colors.ink }}>{money(earnings.walletPaidPaisa)}</Text></View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Muted>{t('cashToCollect')}</Muted><Text style={{ color: colors.ink }}>{money(earnings.cashToCollectPaisa)}</Text></View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.line, marginTop: 6, paddingTop: 6 }}>
            <Text style={{ color: colors.ink, fontWeight: '700' }}>{t('grossLabel')}</Text><Text style={{ color: colors.ink, fontWeight: '700' }}>{money(earnings.grossPaisa)}</Text>
          </View>
        </Card>
      )}

      {activePool && (
        <>
          <Heading style={{ marginTop: 8 }}>{t('activePool')}</Heading>
          <PoolCard pool={activePool} onAdvance={advance} advancing={advancing} onCancel={cancelPool} cancelling={cancellingPool} onNoShow={noShow} />
          {LIVE.has(activePool.status) && <ToggleRow label={t('shareLocation')} value={shareLocation} onValueChange={setShareLocation} />}
        </>
      )}

      <Heading style={{ marginTop: 16 }}>{t('openRequests')}</Heading>
      {!tesla.is_active ? (
        <Muted>{t('goOnlineToSee')}</Muted>
      ) : openRequests.length === 0 ? (
        <Muted>{t('noOpenRequests')}</Muted>
      ) : (
        openRequests.map((r) => {
          const why = reasonOf(r);
          return (
            <Card key={r.id} style={{ opacity: why ? 0.65 : 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>
                    {r.passenger_name || '—'}{r.passenger_rating ? <Text style={{ color: colors.amber, fontSize: 13 }}>  ★ {num(Number(r.passenger_rating))}</Text> : null}
                  </Text>
                  <Muted>{r.pickup_zone_name} → {r.destination_zone_name} · {tn('seat', r.seats_requested)}</Muted>
                  {r.pickup_point_name ? <Muted style={{ fontSize: 12 }}>{r.pickup_point_name}</Muted> : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {r.women_only ? <Tag text={t('womenOnly')} tone="warn" /> : null}
                    {r.fit?.fits ? <Tag text={r.fit.detourPercent ? `${t('fitsPool')} · ${t('detourPct', { n: r.fit.detourPercent })}` : t('fitsPool')} tone="good" /> : null}
                    {why ? <Tag text={why} tone="bad" /> : null}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 8 }}>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{money(r.final_fare_paisa)}</Text>
                  <Button title={activePool ? t('addToPool') : t('accept')} onPress={() => accept(r.id)} loading={acceptingId === r.id} disabled={!!why} style={{ minHeight: 40 }} />
                </View>
              </View>
            </Card>
          );
        })
      )}
    </ScrollView>
  );
}
