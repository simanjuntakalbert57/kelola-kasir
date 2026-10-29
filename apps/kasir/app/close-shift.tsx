import { formatRupiah } from '@kelola-kasir/money';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../src/api/client';
import { useSession } from '../src/auth/SessionProvider';
import { useSales } from '../src/sales/SalesProvider';
import {
  cashDifference,
  closeShift,
  localShiftTotals,
  noteRequired,
  OfflineCloseNotConfirmed,
  totalsFromSummary,
  type CloseOutcome,
  type ShiftTotals,
} from '../src/shift/close';
import { appendDigit, digitsToRupiah } from '../src/shift/prefill';
import { colors, radius, space } from '../src/theme';
import { Banner, Button, Keypad, TopBar } from '../src/ui/components';

function confirmStrong(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm(message));
  return new Promise((resolve) =>
    Alert.alert('Tutup shift tanpa sinkron?', message, [
      { text: 'Batal', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Tetap tutup shift', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export default function CloseShiftScreen() {
  const router = useRouter();
  const { api, session, shift, markShiftClosed, leaveClosedShift } = useSession();
  const { db, online, pending, syncNow, refreshPending } = useSales();
  const [totals, setTotals] = useState<ShiftTotals | null>(null);
  const [fromServer, setFromServer] = useState(false);
  const [digits, setDigits] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CloseOutcome | null>(null);

  // Show the server's figures when reachable (all devices); otherwise this device's own.
  useEffect(() => {
    if (!db || !shift) return;
    void (async () => {
      setTotals(await localShiftTotals(db, shift));
      if (!session?.accessToken) return;
      try {
        setTotals(totalsFromSummary(await api.getShiftSummary(shift.id)));
        setFromServer(true);
      } catch {
        // Offline or server asleep: keep the local figures and the warning.
      }
    })();
  }, [api, db, session, shift]);

  if (!shift || !session) return null;
  const actual = digitsToRupiah(digits);
  const entered = digits !== '';
  const expected = totals?.expectedCash ?? shift.opening_cash;
  const diff = cashDifference(actual, expected);
  const needsNote = entered && noteRequired(diff);
  const canSubmit = !!totals && entered && !busy && (!needsNote || note.trim().length > 0);

  const submit = async () => {
    if (!db || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await syncNow();
      await refreshPending();
      const base = {
        shift,
        employeeId: session.employeeId,
        actualCash: actual,
        note,
      };
      let outcome: CloseOutcome;
      try {
        outcome = await closeShift({ api, db }, { ...base, allowOffline: false });
      } catch (e) {
        if (!(e instanceof OfflineCloseNotConfirmed)) throw e;
        const ok = await confirmStrong(
          `${e.unsynced} transaksi belum tersinkron. Ringkasan bisa berubah setelah sinkron, dan perangkat ini baru bisa buka shift baru saat online. Transaksi tidak hilang.`,
        );
        if (!ok) return;
        outcome = await closeShift({ api, db }, { ...base, allowOffline: true });
      }
      await markShiftClosed(actual);
      await refreshPending();
      setResult(outcome);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'PENDING_QRIS_EXISTS'
          ? 'Masih ada pembayaran QRIS yang menunggu. Konfirmasi atau batalkan dulu.'
          : e instanceof ApiError
            ? e.message
            : 'Gagal menutup shift. Coba lagi.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const t = result.totals;
    return (
      <SafeAreaView style={styles.root}>
        <TopBar title="Shift ditutup" />
        <ScrollView contentContainerStyle={styles.body}>
          {result.mode === 'queued' ? (
            <Banner tone="warn">
              Ditutup offline. {result.unsynced} transaksi belum tersinkron; ringkasan final
              dihitung server setelah tersinkron.
            </Banner>
          ) : (
            <Banner tone="info">Shift ditutup dan dikirim ke owner.</Banner>
          )}
          <Summary totals={t} actual={actual} />
          <Button
            testID="leave"
            label="Keluar"
            variant="primary"
            large
            onPress={() => void leaveClosedShift()}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <TopBar
        title="Tutup shift"
        right={<Button label="Batal" variant="ghost" onPress={() => router.back()} />}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {!online || !fromServer ? (
          <Banner tone="warn">
            {pending > 0 ? `${pending} transaksi belum tersinkron. ` : ''}
            Angka dari perangkat ini saja; ringkasan final dihitung server setelah tersinkron.
          </Banner>
        ) : null}
        {totals ? <Summary totals={totals} /> : null}
        <View style={styles.box}>
          <Text style={styles.label}>Uang kas aktual di laci</Text>
          <Text testID="actual-cash" style={styles.amount}>
            {formatRupiah(actual)}
          </Text>
          {entered ? (
            <Text
              testID="cash-diff"
              style={{ color: diff === 0 ? colors.greenText : colors.warn, fontWeight: '800' }}
            >
              {diff === 0
                ? 'Selisih Rp 0 (pas)'
                : `Selisih ${diff < 0 ? '−' : '+'}${formatRupiah(Math.abs(diff))} (${diff < 0 ? 'kurang' : 'lebih'}). Catatan wajib.`}
            </Text>
          ) : (
            <Text style={styles.label}>Hitung uang di laci lalu masukkan jumlahnya</Text>
          )}
        </View>
        <TextInput
          testID="closing-note"
          value={note}
          onChangeText={setNote}
          placeholder={needsNote ? 'Catatan selisih (wajib)' : 'Catatan (opsional)'}
          placeholderTextColor={colors.muted}
          maxLength={500}
          style={styles.input}
        />
        {error ? <Banner tone="error">{error}</Banner> : null}
      </ScrollView>
      <View style={styles.footer}>
        <Keypad triple onKey={(k) => setDigits((d) => appendDigit(d, k))} />
        <Button
          testID="close-submit"
          label={busy ? 'Menutup…' : 'Tutup shift & kirim ke owner'}
          variant="accent"
          large
          disabled={!canSubmit}
          onPress={() => void submit()}
        />
      </View>
    </SafeAreaView>
  );
}

function Summary({ totals, actual }: { totals: ShiftTotals; actual?: number }) {
  const rows: [string, string][] = [
    ['Modal awal', formatRupiah(totals.openingCash)],
    ['Penjualan cash', formatRupiah(totals.cashSales)],
    ['Kas seharusnya', formatRupiah(totals.expectedCash)],
    ['Penjualan QRIS', formatRupiah(totals.qrisSales)],
    ['Transaksi', String(totals.transactionCount)],
    ['Void menunggu', `${totals.pendingVoidCount} · ${formatRupiah(totals.pendingVoidAmount)}`],
  ];
  if (actual !== undefined) {
    const diff = cashDifference(actual, totals.expectedCash);
    rows.push(['Kas aktual', formatRupiah(actual)]);
    rows.push([
      'Selisih',
      diff === 0 ? 'Rp 0' : `${diff < 0 ? '−' : '+'}${formatRupiah(Math.abs(diff))}`,
    ]);
  }
  return (
    <View style={styles.box} testID="shift-summary">
      {rows.map(([k, v]) => (
        <View key={k} style={styles.row}>
          <Text style={styles.label}>{k}</Text>
          <Text style={styles.value}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  body: { padding: space.s4, gap: space.s3 },
  footer: { padding: space.s4, paddingTop: space.s2, gap: space.s2, backgroundColor: colors.bg },
  box: {
    padding: space.s3,
    gap: space.s2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  value: { color: colors.ink, fontWeight: '700', fontVariant: ['tabular-nums'] },
  amount: { color: colors.ink, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    color: colors.ink,
    paddingHorizontal: space.s4,
  },
});
