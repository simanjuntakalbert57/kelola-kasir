import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, NetworkError } from '../src/api/client';
import { isValidPairingCode, normalizePairingCode, PAIRING_COPY } from '../src/auth/flows';
import { useSession } from '../src/auth/SessionProvider';
import { colors, radius, space } from '../src/theme';
import { Banner, Button } from '../src/ui/components';

function messageFor(error: unknown): string {
  if (error instanceof NetworkError) return 'Tidak ada koneksi. Pairing butuh internet.';
  if (error instanceof ApiError) {
    if (error.status === 429) return 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.';
    return 'Kode salah atau sudah kedaluwarsa. Minta kode baru ke owner.';
  }
  return 'Gagal memasangkan perangkat.';
}

export default function PairingScreen() {
  const { pair } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = normalizePairingCode(code);
  const valid = isValidPairingCode(normalized);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await pair(normalized);
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <Text style={styles.emoji}>🍹</Text>
        <Text style={styles.title}>{PAIRING_COPY.title}</Text>
        <Text style={styles.notPin}>{PAIRING_COPY.notPin}</Text>
        <Text style={styles.sub}>{PAIRING_COPY.subtitle}</Text>
        <View style={styles.steps}>
          {PAIRING_COPY.steps.map((step, i) => (
            <Text key={step} style={styles.step}>
              {i + 1}. {step}
            </Text>
          ))}
        </View>
        <TextInput
          testID="pairing-code"
          style={[styles.input, error ? styles.inputErr : null]}
          value={code}
          onChangeText={(t) => setCode(normalizePairingCode(t).slice(0, 8))}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
          placeholder="ABCD1234"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Kode pairing"
        />
        {error ? <Text style={styles.errText}>{error}</Text> : null}
        <Button
          testID="pair-submit"
          label={busy ? 'Memasangkan…' : 'Pasangkan'}
          variant="primary"
          large
          disabled={!valid || busy}
          onPress={submit}
          style={{ marginTop: space.s4 }}
        />
        <Text style={styles.hint}>Kode berlaku 10 menit dan hanya bisa dipakai sekali.</Text>
      </View>
      {error?.includes('internet') ? <Banner tone="warn">Offline</Banner> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, padding: space.s5, justifyContent: 'center' },
  emoji: { fontSize: 56, textAlign: 'center' },
  title: { color: colors.ink, fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  notPin: { color: colors.danger, fontWeight: '700', textAlign: 'center', marginTop: space.s2 },
  steps: { marginBottom: space.s4, gap: 4 },
  step: { color: colors.ink, lineHeight: 21 },
  sub: { color: colors.muted, textAlign: 'center', marginVertical: space.s4, lineHeight: 21 },
  input: {
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 6,
    textAlign: 'center',
  },
  inputErr: { borderColor: colors.danger },
  errText: { color: colors.danger, textAlign: 'center', marginTop: space.s2 },
  hint: { color: colors.muted, textAlign: 'center', marginTop: space.s4, fontSize: 13 },
});
