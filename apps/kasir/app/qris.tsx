import { formatRupiah } from '@kelola-kasir/money';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, NetworkError } from '../src/api/client';
import { useSession } from '../src/auth/SessionProvider';
import { totalsOf } from '../src/sales/cart';
import {
  cancelQris,
  confirmQris,
  formatCountdown,
  remainingMs,
  startQris,
  type QrisSession,
} from '../src/sales/qris';
import { useSales } from '../src/sales/SalesProvider';
import { colors, space } from '../src/theme';
import { Banner, Button, TopBar } from '../src/ui/components';
import { PrintToggle } from '../src/ui/PrintToggle';
import { QrCode } from '../src/ui/QrCode';

function confirmDialog(message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm(message));
  return new Promise((resolve) =>
    Alert.alert('Konfirmasi pembayaran', message, [
      { text: 'Belum', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Sudah diterima', onPress: () => resolve(true) },
    ]),
  );
}

export default function QrisScreen() {
  const router = useRouter();
  const { api } = useSession();
  const { db, cart, saleContext, completeSale, printReceipt, setPrintReceipt, setQris, online } =
    useSales();
  const total = totalsOf(cart).total;
  const [session, setSession] = useState<QrisSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !db || !saleContext) return;
    started.current = true;
    void (async () => {
      try {
        const s = await startQris(api, db, saleContext, cart);
        setSession(s);
        setQris(s);
      } catch (e) {
        setError(
          e instanceof NetworkError
            ? 'QRIS butuh internet. Gunakan Cash.'
            : e instanceof ApiError
              ? e.message
              : 'Gagal membuat QRIS.',
        );
      }
    })();
  }, [api, db, saleContext, cart, setQris]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = session ? remainingMs(session.expiresAt, now) : 0;
  const expired = !!session && left === 0;

  const cancel = async () => {
    if (session) {
      try {
        await cancelQris(api, session);
      } catch {
        // Already expired/cancelled server side, or offline: the server expires it after 15 minutes.
      }
    }
    setQris(null);
    router.back();
  };

  const confirm = async () => {
    if (!session || !db || !saleContext) return;
    const ok = await confirmDialog(
      `Pastikan notifikasi dana masuk ${formatRupiah(total)} sudah diterima di rekening/e-wallet toko.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await confirmQris(api, db, saleContext, session);
      completeSale({ number: session.body.number, total, method: 'qris' });
      router.replace('/success');
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'Gagal konfirmasi. Periksa koneksi lalu coba lagi.',
      );
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <TopBar title="Bayar QRIS" />
      {!online ? <Banner tone="warn">Koneksi terputus — konfirmasi butuh internet</Banner> : null}
      <View style={styles.body}>
        <Text testID="qris-total" style={styles.total}>
          {formatRupiah(total)}
        </Text>
        {error && !session ? (
          <Banner tone="error">{error}</Banner>
        ) : !session ? (
          <ActivityIndicator color={colors.greenText} style={{ margin: space.s6 }} />
        ) : (
          <>
            <View style={styles.qr}>
              <QrCode value={session.payment.qr_payload ?? session.payment.id} size={240} />
            </View>
            <Text
              testID="qris-countdown"
              style={[styles.countdown, expired && { color: colors.danger }]}
            >
              {expired ? 'Kedaluwarsa' : `Berlaku ${formatCountdown(left)}`}
            </Text>
            <Text style={styles.muted}>
              Minta pembeli scan lalu bayar tepat {formatRupiah(total)}.
            </Text>
            {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          </>
        )}
        <View style={{ flex: 1 }} />
        <PrintToggle value={printReceipt} onChange={setPrintReceipt} />
        {session ? (
          <Button
            testID="qris-confirm"
            label={busy ? 'Memproses…' : 'Pembayaran sudah diterima'}
            variant="primary"
            large
            disabled={busy || expired || !online}
            onPress={() => void confirm()}
          />
        ) : null}
        <Button
          testID="qris-cancel"
          label="Batal"
          variant="outline"
          disabled={busy}
          onPress={() => void cancel()}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, padding: space.s4, gap: space.s3, alignItems: 'stretch' },
  total: {
    color: colors.orange,
    fontSize: 40,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  qr: { alignSelf: 'center', padding: 8, backgroundColor: '#fff', borderRadius: 12 },
  countdown: {
    color: colors.warn,
    fontWeight: '800',
    fontSize: 20,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  muted: { color: colors.muted, textAlign: 'center' },
});
