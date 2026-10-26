import { formatRupiah } from '@kelola-kasir/money';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NetworkError } from '../../src/api/client';
import { useSession } from '../../src/auth/SessionProvider';
import { loadSettings } from '../../src/catalog/sync';
import { uuidv7 } from '../../src/lib/uuid';
import {
  receiptFromApi,
  receiptText,
  shortNumber,
  type ReceiptData,
} from '../../src/printing/layout';
import { loadLocalReceipt } from '../../src/printing/localReceipt';
import { usePrinter } from '../../src/printing/PrinterProvider';
import { shareReceiptText } from '../../src/printing/share';
import { canReprint, STATUS_LABEL } from '../../src/sales/history';
import { useSales } from '../../src/sales/SalesProvider';
import { requestVoid, validateVoidReason, VOID_REASON_MAX } from '../../src/sales/void';
import { colors, radius, space } from '../../src/theme';
import { Banner, Button, TopBar } from '../../src/ui/components';

export default function TransactionDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, session, paired } = useSession();
  const { db, refreshPending, syncNow } = useSales();
  const { reprint } = usePrinter();
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [isLocal, setIsLocal] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const timeZone = paired?.outlet.timezone ?? 'Asia/Jakarta';

  const load = useCallback(async () => {
    if (!db || !id) return;
    const local = await loadLocalReceipt(db, id, {
      settings: await loadSettings(db),
      outletName: paired?.outlet.name ?? 'Kelola Kasir',
      timeZone,
    });
    if (local) {
      setReceipt(local);
      setIsLocal(true);
      return;
    }
    // Made on another device of the outlet: the server has the receipt.
    try {
      setReceipt(receiptFromApi(await api.getReceipt(id), timeZone));
      setIsLocal(false);
    } catch (e) {
      setLoadError(
        e instanceof NetworkError
          ? 'Transaksi dari perangkat lain butuh internet untuk dibuka.'
          : 'Transaksi tidak ditemukan.',
      );
    }
  }, [api, db, id, paired, timeZone]);

  useEffect(() => {
    void load();
  }, [load]);

  const print = async () => {
    if (!receipt || !id) return;
    setBusy(true);
    const res = await reprint(id, isLocal ? undefined : receipt);
    setBusy(false);
    setNotice(
      res.ok
        ? {
            tone: 'info',
            text: `🖨 Cetak ulang berhasil · ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`,
          }
        : { tone: 'error', text: res.message },
    );
  };

  const submitVoid = async () => {
    if (!receipt || !id || !session) return;
    setBusy(true);
    setNotice(null);
    try {
      const text = validateVoidReason(reason);
      if (isLocal && db) {
        await requestVoid(db, { transactionId: id, reason: text, employeeId: session.employeeId });
        await refreshPending();
        void syncNow();
      } else {
        await api.createVoidRequest(id, { id: uuidv7(), reason: text });
      }
      setReceipt({ ...receipt, status: 'void_requested' });
      setReason('');
      setNotice({ tone: 'info', text: 'Pengajuan void terkirim. Menunggu persetujuan owner.' });
    } catch (e) {
      setNotice({
        tone: 'error',
        text:
          e instanceof NetworkError
            ? 'Butuh internet untuk mengajukan void transaksi perangkat lain.'
            : e instanceof Error
              ? e.message
              : 'Gagal mengajukan void.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <TopBar
        title={receipt ? shortNumber(receipt.number) : 'Transaksi'}
        right={<Button label="Tutup" variant="ghost" onPress={() => router.back()} />}
      />
      {loadError ? <Banner tone="error">{loadError}</Banner> : null}
      {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
      {receipt ? (
        <ScrollView contentContainerStyle={styles.body}>
          <Text
            testID="detail-status"
            style={[
              styles.status,
              { color: receipt.status === 'paid' ? colors.greenText : colors.warn },
            ]}
          >
            {STATUS_LABEL[receipt.status] ?? receipt.status}
            {receipt.pendingSync ? ' · ⏳ Belum sinkron' : ''}
          </Text>
          <View style={styles.paper}>
            <Text testID="receipt-preview" style={styles.paperText}>
              {receiptText({ ...receipt, reprint: false })}
            </Text>
          </View>
          <Text style={styles.total}>Total {formatRupiah(receipt.total)}</Text>
          {canReprint(receipt.status) ? (
            <Button
              testID="detail-reprint"
              label="🖨 Cetak ulang"
              variant="primary"
              large
              disabled={busy}
              onPress={() => void print()}
            />
          ) : null}
          <Button
            testID="detail-share"
            label="Kirim WhatsApp"
            onPress={() => void shareReceiptText(receiptText({ ...receipt, reprint: false }))}
          />
          {receipt.status === 'paid' ? (
            <View style={styles.voidBox}>
              <Text style={styles.section}>Ajukan pembatalan (void)</Text>
              <TextInput
                testID="void-reason"
                value={reason}
                onChangeText={setReason}
                placeholder="Alasan void (wajib)"
                placeholderTextColor={colors.muted}
                maxLength={VOID_REASON_MAX}
                multiline
                style={styles.input}
              />
              <Text style={styles.hint}>
                Perlu persetujuan owner di dashboard. Struk tetap sah sampai disetujui.
              </Text>
              <Button
                testID="void-submit"
                label="Ajukan pembatalan"
                variant="accent"
                disabled={busy || reason.trim().length < 3}
                onPress={() => void submitVoid()}
              />
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.s4, gap: space.s3 },
  status: { fontSize: 16, fontWeight: '800' },
  paper: { alignSelf: 'center', backgroundColor: '#fff', padding: space.s3, borderRadius: 6 },
  paperText: {
    color: '#111',
    fontFamily: Platform.select({ android: 'monospace', default: 'Courier' }),
    fontSize: 12,
  },
  total: { color: colors.orange, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  voidBox: {
    gap: space.s2,
    padding: space.s3,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  section: { color: colors.ink, fontWeight: '800' },
  input: {
    minHeight: 72,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.s3,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  hint: { color: colors.muted, fontSize: 12 },
});
