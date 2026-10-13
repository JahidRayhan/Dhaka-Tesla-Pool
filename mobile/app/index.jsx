import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { useAuth } from '../lib/AuthContext';
import { colors } from '../lib/theme';

export default function Welcome() {
  const { user, loading } = useAuth();
  const router = useRouter();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.rickshaw} />
      </View>
    );
  }
  if (user) return <Redirect href={user.role === 'driver' ? '/driver' : '/passenger'} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28 }}>
        <Text style={{ color: colors.muted, letterSpacing: 1.5, fontSize: 12, marginBottom: 10 }}>BANANI · GULSHAN · MOHAKHALI</Text>
        <Text style={{ fontSize: 42, lineHeight: 44, fontWeight: '800', color: colors.ink }}>Share a seat.{'\n'}Split the fare.{'\n'}Survive Dhaka traffic.</Text>
        <Text style={{ color: colors.muted, fontSize: 16, marginTop: 16, marginBottom: 28 }}>
          Request a Tesla, pool with someone headed your way, and see exactly what you owe before you get in.
        </Text>
        <View style={{ gap: 10 }}>
          <Button title="Sign in" onPress={() => router.push('/login')} />
          <Button title="Create an account" variant="secondary" onPress={() => router.push('/signup')} />
        </View>
      </View>
    </SafeAreaView>
  );
}
