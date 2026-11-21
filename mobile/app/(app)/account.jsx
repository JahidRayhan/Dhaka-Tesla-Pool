import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Banner, Button, Card, Chip, Field, Heading, LinkButton, Muted, Tag } from '../../components/ui';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { useI18n } from '../../lib/LanguageContext';
import { colors } from '../../lib/theme';

const GENDERS = [['female', 'g_female'], ['male', 'g_male'], ['other', 'g_other'], [null, 'g_unset']];
const TIMES = ['06:30', '07:30', '08:30', '09:30', '17:30', '18:30'];

export default function AccountScreen() {
  const { token, user, setUser, logout } = useAuth();
  const { t, lang, setLang, num } = useI18n();
  const [name, setName] = useState(user?.name || '');
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  const [phone, setPhone] = useState(user?.phone || '');
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState('');

  const [zones, setZones] = useState([]);
  const [commutes, setCommutes] = useState([]);
  const [draft, setDraft] = useState({ pickupZoneId: null, destinationZoneId: null, days: [1, 2, 3, 4, 5], time: '08:30' });
  const [adding, setAdding] = useState(false);

  const fail = (err) => setError(err instanceof ApiRequestError ? err.message : t('genericError'));
  const canRide = user?.role !== 'driver' && user?.role !== 'admin';

  const loadCommutes = useCallback(async () => {
    if (!canRide) return;
    try {
      setCommutes((await api.recurringRides(token)).recurringRides);
    } catch (err) { fail(err); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canRide]);

  useEffect(() => {
    if (!canRide) return;
    api.zones().then((d) => {
      setZones(d.zones);
      if (d.zones.length > 1) setDraft((x) => ({ ...x, pickupZoneId: d.zones[0].id, destinationZoneId: d.zones[1].id }));
    }).catch(() => {});
    loadCommutes();
  }, [canRide, loadCommutes]);

  async function saveProfile(patch) {
    setError(null);
    setNote(null);
    try {
      const { user: updated } = await api.updateProfile(token, patch);
      setUser((u) => ({ ...u, ...updated }));
      setNote(t('saved'));
    } catch (err) { fail(err); }
  }

  async function chooseLanguage(next) {
    setLang(next); // takes effect immediately
    saveProfile({ locale: next }); // and tells the server, so push messages arrive in the same language
  }

  async function sendCode() {
    setError(null);
    try {
      await api.requestPhoneOtp(token, phone.trim() || undefined);
      setOtpSent(true);
    } catch (err) { fail(err); }
  }

  async function verify() {
    setError(null);
    try {
      await api.verifyPhoneOtp(token, code);
      const { user: fresh } = await api.me(token);
      setUser(fresh);
      setOtpSent(false);
      setCode('');
      setNote(t('phoneVerified'));
    } catch (err) { fail(err); }
  }

  async function addCommute() {
    setAdding(true);
    setError(null);
    try {
      await api.createRecurringRide(token, {
        pickupZoneId: draft.pickupZoneId,
        destinationZoneId: draft.destinationZoneId,
        daysOfWeek: draft.days,
        timeOfDay: draft.time,
      });
      await loadCommutes();
    } catch (err) { fail(err); } finally { setAdding(false); }
  }

  const zoneName = (id) => zones.find((z) => z.id === id)?.name ?? id;
  const toggleDay = (d) => setDraft((x) => ({ ...x, days: x.days.includes(d) ? x.days.filter((v) => v !== d) : [...x.days, d].sort() }));
  const chipRow = (children) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>{children}</View>;
  const zoneChips = (selected, onSelect) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {zones.map((z) => <Chip key={z.id} label={z.name} selected={selected === z.id} onPress={() => onSelect(z.id)} />)}
    </ScrollView>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Heading>{t('account')}</Heading>
      <Banner text={error} />
      {note ? <Muted style={{ marginBottom: 8, color: colors.transit }}>{note}</Muted> : null}

      <Card>
        <Field label={t('name')} value={name} onChangeText={setName} autoCapitalize="words" />
        <Button title={t('save')} variant="secondary" onPress={() => saveProfile({ name })} disabled={!name.trim() || name.trim() === user?.name} />

        <Muted style={{ marginTop: 16, marginBottom: 6 }}>{t('language')}</Muted>
        {chipRow([
          <Chip key="en" label={t('english')} selected={lang === 'en'} onPress={() => chooseLanguage('en')} />,
          <Chip key="bn" label={t('bangla')} selected={lang === 'bn'} onPress={() => chooseLanguage('bn')} />,
        ])}

        <Muted style={{ marginTop: 16, marginBottom: 6 }}>{t('gender')}</Muted>
        {chipRow(GENDERS.map(([value, label]) => (
          <Chip key={label} label={t(label)} selected={(user?.gender ?? null) === value} onPress={() => saveProfile({ gender: value })} />
        )))}
        <Muted style={{ marginTop: 4, fontSize: 12 }}>{t('genderHelp')}</Muted>
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{t('verifyPhoneTitle')}</Text>
          <Tag text={user?.phone_verified_at ? t('phoneVerified') : t('phoneNotVerified')} tone={user?.phone_verified_at ? 'good' : 'warn'} />
        </View>
        {!user?.phone_verified_at && (
          <View style={{ marginTop: 10 }}>
            <Field label={t('phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            {!otpSent ? (
              <Button title={t('verifyNow')} onPress={sendCode} disabled={!phone.trim()} />
            ) : (
              <>
                <Field label={t('enterCode')} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
                <Button title={t('verify')} onPress={verify} disabled={code.length !== 6} />
              </>
            )}
          </View>
        )}
      </Card>

      {canRide && (
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{t('commutes')}</Text>
          <Muted style={{ marginBottom: 10 }}>{t('commutesHelp')}</Muted>
          {commutes.length === 0 ? <Muted>{t('noCommutes')}</Muted> : commutes.map((c) => (
            <View key={c.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
              <Text style={{ color: colors.ink, fontSize: 15 }}>{zoneName(c.pickup_zone_id)} → {zoneName(c.destination_zone_id)}</Text>
              <Muted>{c.days_of_week.map((d) => t(`d${d}`)).join(' · ')} · {num(c.time_of_day)}</Muted>
              <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
                <LinkButton title={c.active ? t('cancel') : t('add')} onPress={() => api.setRecurringActive(token, c.id, !c.active).then(loadCommutes).catch(fail)} />
                <LinkButton title={t('delete')} onPress={() => api.deleteRecurringRide(token, c.id).then(loadCommutes).catch(fail)} />
              </View>
            </View>
          ))}

          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink, marginTop: 14, marginBottom: 6 }}>{t('addCommute')}</Text>
          <Muted style={{ marginBottom: 4 }}>{t('pickup')}</Muted>
          {zoneChips(draft.pickupZoneId, (id) => setDraft((x) => ({ ...x, pickupZoneId: id })))}
          <Muted style={{ marginTop: 10, marginBottom: 4 }}>{t('dropoff')}</Muted>
          {zoneChips(draft.destinationZoneId, (id) => setDraft((x) => ({ ...x, destinationZoneId: id })))}
          <Muted style={{ marginTop: 10, marginBottom: 4 }}>{t('days')}</Muted>
          {chipRow([1, 2, 3, 4, 5, 6, 7].map((d) => <Chip key={d} label={t(`d${d}`)} selected={draft.days.includes(d)} onPress={() => toggleDay(d)} />))}
          <Muted style={{ marginTop: 10, marginBottom: 4 }}>{t('time')}</Muted>
          {chipRow(TIMES.map((tm) => <Chip key={tm} label={num(tm)} selected={draft.time === tm} onPress={() => setDraft((x) => ({ ...x, time: tm }))} />))}
          <View style={{ marginTop: 14 }}>
            <Button title={t('create')} onPress={addCommute} loading={adding} disabled={draft.days.length === 0 || draft.pickupZoneId === draft.destinationZoneId} />
          </View>
        </Card>
      )}

      {user?.role === 'admin' && <Muted>{t('adminOnWeb')}</Muted>}
      <View style={{ alignItems: 'center', gap: 14, marginTop: 8 }}>
        <LinkButton title={t('signOutEverywhere')} onPress={() => api.logoutEverywhere(token).catch(() => {}).finally(logout)} />
        <LinkButton title={t('signOut')} onPress={logout} />
      </View>
    </ScrollView>
  );
}
