import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { useAuth } from '../lib/AuthContext';
import { useI18n } from '../lib/LanguageContext';
import { colors } from '../lib/theme';

export default function Welcome() {
  const { user, loading } = useAuth();
  const { t, lang, setLang } = useI18n();
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
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: 16 }}>
        <Button title={lang === 'bn' ? 'English' : 'বাংলা'} variant="secondary" onPress={() => setLang(lang === 'bn' ? 'en' : 'bn')} style={{ minHeight: 36, paddingHorizontal: 14 }} />
      </View>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28 }}>
        <Text style={{ color: colors.muted, letterSpacing: 1.5, fontSize: 12, marginBottom: 10 }}>{t('areas')}</Text>
        <Text style={{ fontSize: 40, lineHeight: 46, fontWeight: '800', color: colors.ink }}>{t('heroTitle')}</Text>
        <Text style={{ color: colors.muted, fontSize: 16, marginTop: 16, marginBottom: 28 }}>{t('heroSubtitle')}</Text>
        <View style={{ gap: 10 }}>
          <Button title={t('signIn')} onPress={() => router.push('/login')} />
          <Button title={t('createAccount')} variant="secondary" onPress={() => router.push('/signup')} />
        </View>
      </View>
    </SafeAreaView>
  );
}
