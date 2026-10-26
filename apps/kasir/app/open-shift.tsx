import { formatRupiah } from '@kelola-kasir/money';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../src/auth/SessionProvider';
import { canOpenShift, describeOpenShiftError } from '../src/shift/open';
import { appendDigit, digitsToRupiah } from '../src/shift/prefill';
import { IS_STAGING } from '../src/config';
import { colors, radius, space } from '../src/theme';
import { Banner, Button, Keypad, TopBar } from '../src/ui/components';

export default function OpenShiftScreen() {
  const {
    session,
    shiftChecked,
    checkShift,
    openShift,
    suggestedOpeningCash,
    logout,
    resetDevice,
  } = useSession();
  const router = useRouter();
  const [digits, setDigits] = useState('');
  const [suggested, setSuggested] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        await checkShift();
      } catch {
        setCheckFailed(true);
      }
      const s = await suggestedOpeningCash();
      setSuggested(s);
      if (s !== null) setDigits(String(s));
    })();
  }, [checkShift, suggestedOpeningCash]);

  const amount = digitsToRupiah(digits);
  const offline = session?.offline ?? false;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await openShift(amount);
      router.replace('/jual');
    } catch (e) {
      const failure = describeOpenShiftError(e);
      const detail = IS_STAGING && e instanceof Error ? `\n${e.name}: ${e.message}` : '';
      setError(failure.message + detail);
      if (failure.action === 'login') await logout();
      else if (failure.action === 'reset') await resetDevice();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <TopBar
        title="Buka shift"
        right={<Button label="Keluar" variant="ghost" onPress={logout} />}
      />
      {offline ? <Banner tone="warn">Offline — buka shift butuh internet</Banner> : null}
      {!shiftChecked && !checkFailed && !offline ? (
        <Banner tone="warn">Memeriksa shift…</Banner>
      ) : null}
      {checkFailed ? <Banner tone="error">Gagal memeriksa shift. Coba lagi.</Banner> : null}
      <View style={styles.body}>
        <Text style={styles.hello}>
          Halo, {session?.employeeName}! Hitung uang di laci lalu masukkan modal awal.
        </Text>
        <Text style={styles.label}>Modal kas awal</Text>
        <View style={styles.amountBox} accessibilityLabel="Modal kas awal">
          <Text testID="opening-cash" style={styles.amount}>
            {formatRupiah(amount)}
          </Text>
        </View>
        {suggested !== null ? (
          <Text style={styles.hint}>
            Shift terakhir ditutup {formatRupiah(suggested)} — sudah terisi otomatis.
          </Text>
        ) : (
          <Text style={styles.hint}>Belum ada data shift sebelumnya di perangkat ini.</Text>
        )}
        {error ? <Text style={styles.err}>{error}</Text> : null}
        <View style={{ flex: 1 }} />
        <Keypad triple onKey={(k) => setDigits((d) => appendDigit(d, k))} />
        <Button
          testID="open-shift-submit"
          label={
            busy
              ? 'Membuka…'
              : !shiftChecked && !checkFailed && !offline
                ? 'Memeriksa shift…'
                : 'Buka shift & mulai jualan'
          }
          variant="primary"
          large
          disabled={!canOpenShift({ offline, busy, shiftChecked, checkFailed })}
          onPress={submit}
          style={{ marginTop: space.s3 }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, padding: space.s4 },
  hello: { color: colors.muted, lineHeight: 21 },
  label: {
    color: colors.ink,
    fontWeight: '600',
    fontSize: 14,
    marginTop: space.s4,
    marginBottom: 4,
  },
  amountBox: {
    minHeight: 64,
    justifyContent: 'center',
    paddingHorizontal: space.s4,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  amount: { color: colors.ink, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  hint: { color: colors.muted, fontSize: 13, marginTop: 6 },
  err: { color: colors.danger, marginTop: space.s2 },
});
