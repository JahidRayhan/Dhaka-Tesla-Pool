import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Field, Heading, LinkButton, Muted } from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { useI18n } from '../lib/LanguageContext';
import { colors } from '../lib/theme';

// Two steps: ask for a code by SMS, then set a new password with it. The first
// step looks identical whether or not the number is registered, on purpose.
export default function Forgot() {
  const { t } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('genericError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <Heading style={{ fontSize: 26 }}>{t('resetPassword')}</Heading>
          <Field label={t('phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" editable={step === 1} />
          {step === 1 ? (
            <>
              <Banner text={error} />
              <Button title={t('sendCode')} loading={busy} disabled={!phone} onPress={() => run(async () => { await api.forgotPassword(phone.trim()); setStep(2); })} />
            </>
          ) : (
            <>
              <Muted style={{ marginBottom: 12 }}>{t('codeSent')}</Muted>
              <Field label={t('code')} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
              <Field label={t('newPassword')} value={newPassword} onChangeText={setNewPassword} secureTextEntry autoComplete="new-password" />
              <Banner text={error} />
              <Button
                title={t('resetPassword')}
                loading={busy}
                disabled={code.length !== 6 || newPassword.length < 8}
                onPress={() => run(async () => { await api.resetPassword({ phone: phone.trim(), code, newPassword }); router.replace('/login'); })}
              />
            </>
          )}
          <LinkButton title={t('back')} onPress={() => router.back()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
