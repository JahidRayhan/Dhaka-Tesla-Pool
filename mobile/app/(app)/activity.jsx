import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Banner, Card, Heading, LinkButton, Muted } from '../../components/ui';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { useI18n } from '../../lib/LanguageContext';
import { usePolling } from '../../lib/usePolling';
import { colors } from '../../lib/theme';

export default function ActivityScreen() {
  const { token, logout } = useAuth();
  const { t, num } = useI18n();
  const [items, setItems] = useState(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.notifications(token);
      setItems(data.notifications);
      setUnread(data.unreadCount);
      setError(null);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) logout();
      else setError(err instanceof ApiRequestError ? err.message : t('genericError'));
    }
  }, [token, logout, t]);

  useEffect(() => { load(); }, [load]);
  usePolling(load, 10000, true);

  async function markAll() {
    try {
      await api.markNotificationsRead(token, 'all');
      await load();
    } catch {
      // not critical
    }
  }

  // Seeing the list counts as reading it: clear the tab badge a moment after it appears.
  useEffect(() => {
    if (unread === 0) return undefined;
    const id = setTimeout(markAll, 3000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Heading>{t('activity')}</Heading>
        {unread > 0 && <LinkButton title={t('markAllRead')} onPress={markAll} />}
      </View>
      <Banner text={error} />
      {items === null ? (
        <Muted>{t('loading')}</Muted>
      ) : items.length === 0 ? (
        <Muted>{t('noNotifications')}</Muted>
      ) : (
        items.map((n) => (
          <Card key={n.id} style={n.read_at ? undefined : { borderColor: colors.rickshaw + '88' }}>
            <Text style={{ fontSize: 15, fontWeight: n.read_at ? '500' : '700', color: colors.ink }}>{n.title}</Text>
            <Text style={{ color: colors.ink, fontSize: 14, marginTop: 2 }}>{n.body}</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>
              {new Date(n.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </Card>
        ))
      )}
      <Text style={{ display: 'none' }}>{num(0)}</Text>
    </ScrollView>
  );
}
