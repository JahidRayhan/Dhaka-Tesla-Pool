import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { colors, STATUS_COLOR } from '../lib/theme';
import { STATUS_TONE } from '../lib/format';
import { useI18n } from '../lib/LanguageContext';

export function Button({ title, onPress, variant = 'primary', disabled, loading, style }) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading) }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.buttonPrimary : styles.buttonSecondary,
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? '#fff' : colors.ink} />
      ) : (
        <Text style={[styles.buttonText, { color: primary ? '#fff' : colors.ink }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function LinkButton({ title, onPress, disabled }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} hitSlop={8}>
      <Text style={[styles.link, disabled && { opacity: 0.4 }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, style, ...props }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        style={[styles.input, style]}
        {...props}
      />
    </View>
  );
}

export function Banner({ text, tone = 'error' }) {
  if (!text) return null;
  const color = tone === 'error' ? colors.rickshawDark : colors.amber;
  return (
    <View style={[styles.banner, { borderColor: color + '55', backgroundColor: color + '10' }]} accessibilityRole="alert">
      <Text style={{ color, fontSize: 14 }}>{text}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={{ color: selected ? '#fff' : colors.ink, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function StatusBadge({ status }) {
  const { t } = useI18n();
  const color = STATUS_COLOR[STATUS_TONE[status]] || colors.muted;
  const label = t(`s_${status}`);
  return (
    <View style={[styles.badge, { borderColor: color + '66', backgroundColor: color + '12' }]}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{label === `s_${status}` ? status : label}</Text>
    </View>
  );
}

/** A small coloured label, e.g. a verification state or "fits your pool". */
export function Tag({ text, tone = 'muted' }) {
  const color = tone === 'good' ? colors.transit : tone === 'warn' ? colors.amber : tone === 'bad' ? colors.rickshawDark : colors.muted;
  return (
    <View style={[styles.badge, { borderColor: color + '66', backgroundColor: color + '12' }]}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

/** Tappable 1-5 stars. */
export function Stars({ value, onChange, size = 30 }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange?.(n)} disabled={!onChange} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${n}`}>
          <Text style={{ fontSize: size, color: n <= value ? colors.amber : colors.line }}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A labelled on/off row with optional help text underneath. */
export function ToggleRow({ label, help, value, onValueChange, disabled }) {
  return (
    <View style={{ marginTop: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.ink, fontSize: 15, flex: 1, paddingRight: 12 }}>{label}</Text>
        <Switch value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ true: colors.rickshaw, false: colors.line }} />
      </View>
      {help ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{help}</Text> : null}
    </View>
  );
}

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Heading({ children, style }) {
  return <Text style={[styles.heading, style]}>{children}</Text>;
}

export function Muted({ children, style }) {
  return <Text style={[{ color: colors.muted, fontSize: 14 }, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: { minHeight: 46, paddingHorizontal: 18, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  buttonPrimary: { backgroundColor: colors.rickshaw },
  buttonSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  buttonText: { fontSize: 15, fontWeight: '600' },
  link: { color: colors.muted, fontSize: 14, textDecorationLine: 'underline' },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    borderRadius: 3,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.ink,
  },
  banner: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    marginRight: 8,
  },
  chipSelected: { backgroundColor: colors.ink, borderColor: colors.ink },
  badge: { borderWidth: 1, borderRadius: 3, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 3, padding: 16, marginBottom: 12 },
  heading: { fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 12 },
});
