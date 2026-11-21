import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Field, Heading, LinkButton } from '../components/ui';
import { ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useI18n } from '../lib/LanguageContext';
import { colors } from '../lib/theme';

export default function Login() {
  const { login } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      router.replace(user.role === 'driver' ? '/driver' : '/passenger');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('signInFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <Heading style={{ fontSize: 28 }}>{t('signIn')}</Heading>
          <Field label={t('email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
          <Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={submit} />
          <Banner text={error} />
          <Button title={t('signIn')} onPress={submit} loading={submitting} disabled={!email || !password} />
          <View style={{ alignItems: 'center', marginTop: 14 }}>
            <LinkButton title={t('forgotPassword')} onPress={() => router.push('/forgot')} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 18 }}>
            <Text style={{ color: colors.muted }}>{t('newHere')}</Text>
            <LinkButton title={t('createAccount')} onPress={() => router.replace('/signup')} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
