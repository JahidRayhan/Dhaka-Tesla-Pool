import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useAuth } from '../../lib/AuthContext';
import { colors } from '../../lib/theme';

export default function AppLayout() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.rickshaw} />
      </View>
    );
  }
  if (!user) return <Redirect href="/" />;

  // Same split as the web app: passengers ride, drivers drive, "both" gets both tabs.
  const canRide = user.role !== 'driver';
  const canDrive = user.role === 'driver' || user.role === 'both';

  return (
    <Tabs
      screenOptions={{
        headerTitle: 'Dhaka Tesla Pool',
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { fontWeight: '800', color: colors.ink },
        headerShadowVisible: false,
        tabBarActiveTintColor: colors.rickshaw,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.card },
        headerRight: () => (
          <Pressable onPress={logout} hitSlop={10} style={{ marginRight: 16 }} accessibilityRole="button">
            <Text style={{ color: colors.muted, textDecorationLine: 'underline' }}>{user.name} · Sign out</Text>
          </Pressable>
        ),
      }}
    >
      <Tabs.Screen name="passenger" options={{ title: 'Ride', tabBarIcon: () => null, href: canRide ? '/passenger' : null }} />
      <Tabs.Screen name="driver" options={{ title: 'Drive', tabBarIcon: () => null, href: canDrive ? '/driver' : null }} />
    </Tabs>
  );
}
