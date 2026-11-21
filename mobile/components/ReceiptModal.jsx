import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, ApiRequestError } from '../lib/api';
import { useI18n } from '../lib/LanguageContext';
import { colors } from '../lib/theme';
import { Banner, Button, Card, Heading, Muted } from './ui';

const Row = ({ label, value, bold }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }}>
    <Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text>
    <Text style={{ color: colors.ink, fontSize: 14, fontWeight: bold ? '700' : '400' }}>{value}</Text>
  </View>
);

/** The fare breakdown for one finished ride. */
export default function ReceiptModal({ visible, token, rideId, onClose }) {
  const { t, money, num } = useI18n();
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible || !rideId) return;
    setReceipt(null);
    setError(null);
    api.receipt(token, rideId).then((d) => setReceipt(d.receipt)).catch((err) => setError(err instanceof ApiRequestError ? err.message : t('genericError')));
  }, [visible, rideId, token, t]);

  const r = receipt;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Heading>{t('receipt')}</Heading>
          <Banner text={error} />
          {!r && !error && <ActivityIndicator color={colors.rickshaw} />}
          {r && (
            <Card>
              <Text style={{ fontSize: 17, fontWeight: '600', color: colors.ink }}>
                {r.route.pickup} → {r.route.destination}
              </Text>
              {r.route.pickupPoint ? <Muted>{r.route.pickupPoint}</Muted> : null}
              <Muted style={{ marginBottom: 10 }}>
                {r.times.completedAt || r.times.cancelledAt ? new Date(r.times.completedAt || r.times.cancelledAt).toLocaleString() : ''}
              </Muted>
              {r.kind === 'FARE' ? (
                <>
                  <Row label={t('baseFare')} value={money(r.fare.basePaisa)} />
                  <Row label={t('distanceCharge')} value={money(r.fare.distancePaisa)} />
                  {r.fare.poolDiscountPaisa > 0 && <Row label={t('poolDiscount')} value={`− ${money(r.fare.poolDiscountPaisa)}`} />}
                </>
              ) : (
                <Row label={t('noShowFee')} value={money(r.fare.noShowFeePaisa)} />
              )}
              <View style={{ borderTopWidth: 1, borderTopColor: colors.line, marginTop: 6, paddingTop: 6 }}>
                <Row label={t('total')} value={money(r.fare.totalPaisa)} bold />
              </View>
              <Muted style={{ marginTop: 10 }}>
                {t('paidBy', { method: r.payment.method === 'TESLAPAY' ? t('teslaPay') : t('cash'), status: r.payment.status === 'PAID' ? t('paymentPaid') : t('paymentPending') })}
              </Muted>
              {r.sharedWith > 0 && <Muted>{t('sharedWithCount', { n: r.sharedWith })}</Muted>}
              <Muted>
                {t('driverLabel')}: {r.driver.name} · {r.driver.teslaName}
                {r.driver.vehiclePlate ? ` · ${r.driver.vehiclePlate}` : ''}
              </Muted>
            </Card>
          )}
          <Button title={t('close')} variant="secondary" onPress={onClose} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
