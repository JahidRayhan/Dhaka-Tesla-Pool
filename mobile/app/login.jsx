import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, Field, Heading, LinkButton } from '../components/ui';
import { ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { colors } from '../lib/theme';

export default function Login() {
  const { login } = useAuth();
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
      setError(err instanceof ApiRequestError ? err.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <Heading style={{ fontSize: 28 }}>Sign in</Heading>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            onSubmitEditing={submit}
          />
          <Banner text={error} />
          <Button title="Sign in" onPress={submit} loading={submitting} disabled={!email || !password} />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 18 }}>
            <Text style={{ color: colors.muted }}>New here?</Text>
            <LinkButton title="Create an account" onPress={() => router.replace('/signup')} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
