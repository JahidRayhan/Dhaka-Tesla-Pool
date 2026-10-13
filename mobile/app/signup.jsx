import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Chip, Field, Heading, LinkButton } from '../components/ui';
import { ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { colors } from '../lib/theme';

export default function Signup() {
  const { signup } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', role: 'passenger' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit() {
    setError(null);
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const user = await signup({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        password: form.password,
        role: form.role,
      });
      router.replace(user.role === 'driver' ? '/driver' : '/passenger');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create your account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <Heading style={{ fontSize: 28 }}>Create an account</Heading>
          <Field label="Name" value={form.name} onChangeText={set('name')} autoCapitalize="words" autoComplete="name" />
          <Field label="Email" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoComplete="email" />
          <Field label="Phone (optional)" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" />
          <Field label="Password (8+ characters)" value={form.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" />
          <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 6 }}>I want to</Text>
          <View style={{ flexDirection: 'row', marginBottom: 18 }}>
            <Chip label="Book rides" selected={form.role === 'passenger'} onPress={() => set('role')('passenger')} />
            <Chip label="Drive a Tesla" selected={form.role === 'driver'} onPress={() => set('role')('driver')} />
          </View>
          <Banner text={error} />
          <Button title="Create account" onPress={submit} loading={submitting} disabled={!form.name || !form.email || !form.password} />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 18 }}>
            <Text style={{ color: colors.muted }}>Have an account?</Text>
            <LinkButton title="Sign in" onPress={() => router.replace('/login')} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
