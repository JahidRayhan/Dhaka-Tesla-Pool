import { Redirect, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import { useI18n } from '../../lib/LanguageContext';
import { usePushRegistration } from '../../lib/usePush';
import { colors } from '../../lib/theme';

export default function AppLayout() {
  const { user, token, loading, logout } = useAuth();
  const { t, lang } = useI18n();
  const [unread, setUnread] = useState(0);

  usePushRegistration(token);

  // Push messages are written on the server in the user's language; keep it in step with the app's.
  useEffect(() => {
    if (token && user && user.locale && user.locale !== lang) api.updateProfile(token, { locale: lang }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id, lang]);

  // A cheap, slow poll for the badge on the Activity tab (the full inbox loads on that tab).
  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    const load = () => api.notifications(token, true).then((d) => alive && setUnread(d.unreadCount)).catch(() => {});
    load();
    const id = setInterval(load, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [token]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.rickshaw} />
      </View>
    );
  }
  if (!user) return <Redirect href="/" />;

  // Same split as the web app: passengers ride, drivers drive, "both" gets both tabs.
  const canRide = user.role !== 'driver' && user.role !== 'admin';
  const canDrive = user.role === 'driver' || user.role === 'both';

  return (
    <Tabs
      screenOptions={{
        headerTitle: t('appName'),
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { fontWeight: '800', color: colors.ink },
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.rickshaw,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.card },
        headerRight: () => (
          <Pressable onPress={logout} hitSlop={10} style={{ marginRight: 16 }} accessibilityRole="button">
            <Text style={{ color: colors.muted, textDecorationLine: 'underline' }}>{user.name} · {t('signOut')}</Text>
          </Pressable>
        ),
      }}
    >
      <Tabs.Screen name="passenger" options={{ title: t('tabRide'), tabBarIcon: () => null, href: canRide ? '/passenger' : null }} />
      <Tabs.Screen name="driver" options={{ title: t('tabDrive'), tabBarIcon: () => null, href: canDrive ? '/driver' : null }} />
      <Tabs.Screen name="activity" options={{ title: t('tabActivity'), tabBarIcon: () => null, tabBarBadge: unread > 0 ? unread : undefined }} />
      <Tabs.Screen name="account" options={{ title: t('tabAccount'), tabBarIcon: () => null }} />
    </Tabs>
  );
}
