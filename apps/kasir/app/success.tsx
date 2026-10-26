import { formatRupiah } from '@kelola-kasir/money';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadSettings } from '../src/catalog/sync';
import { useSession } from '../src/auth/SessionProvider';
import { receiptText } from '../src/printing/layout';
import { loadLocalReceipt } from '../src/printing/localReceipt';
import { usePrinter } from '../src/printing/PrinterProvider';
import { shareReceiptText } from '../src/printing/share';
import { useSales } from '../src/sales/SalesProvider';
import { colors, radius, space } from '../src/theme';
import { Banner, Button } from '../src/ui/components';
import { PrintBanner } from '../src/ui/PrintBanner';

export default function SuccessScreen() {
  const router = useRouter();
  const { paired } = useSession();
  const { db, lastSale, newOrder, pending, online, printReceipt } = useSales();
  const { job, saved, status, reprint, autoPrint, reconnect, dismissJob } = usePrinter();
  const [sharing, setSharing] = useState(false);
  const mine = job && job.transactionId === lastSale?.id ? job : null;

  const done = () => {
    dismissJob();
    newOrder();
    router.replace('/jual');
  };

  const share = async () => {
    if (!db || !lastSale || sharing) return;
    setSharing(true);
    try {
      const receipt = await loadLocalReceipt(db, lastSale.id, {
        settings: await loadSettings(db),
        outletName: paired?.outlet.name ?? 'Kelola Kasir',
        timeZone: paired?.outlet.timezone ?? 'Asia/Jakarta',
      });
      if (receipt) await shareReceiptText(receiptText(receipt));
    } finally {
      setSharing(false);
    }
  };

  const retry = async () => {
    if (!lastSale) return;
    await reconnect();
    // Nothing reached the paper unless the link broke mid-print: then the copy is a reprint.
    if (mine?.reason === 'write_failed') await reprint(lastSale.id);
    else autoPrint(lastSale.id);
  };

  const printing = mine?.state === 'printing';
  return (
    <SafeAreaView style={styles.root}>
      {!online || pending > 0 ? (
        <Banner tone="info">
          {pending > 0 ? `${pending} transaksi belum tersinkron` : 'Offline'} — tersimpan di
          perangkat
        </Banner>
      ) : null}
      <View style={styles.body}>
        <Text style={{ fontSize: 56 }}>✅</Text>
        <Text style={styles.title}>{mine?.state === 'failed' ? 'Lunas · tersimpan' : 'Lunas'}</Text>
        <Text testID="sale-total" style={styles.total}>
          {formatRupiah(lastSale?.total ?? 0)}
        </Text>
        <Text style={styles.muted}>{lastSale?.number}</Text>
        {lastSale?.method === 'cash' ? (
          <Text testID="sale-change" style={styles.change}>
            Kembalian {formatRupiah(lastSale.change ?? 0)}
          </Text>
        ) : (
          <Text style={styles.muted}>QRIS · dikonfirmasi manual</Text>
        )}
        <PrintBanner
          job={mine}
          printReceipt={printReceipt}
          printerName={saved?.name ?? null}
          connecting={status === 'connecting'}
          onRetry={() => void retry()}
          onSkip={dismissJob}
          onSettings={() => router.push('/printer')}
        />
      </View>
      <View style={styles.actions}>
        <View style={styles.secondary}>
          <Button
            testID="reprint"
            label="🖨 Cetak ulang"
            disabled={printing || !lastSale}
            onPress={() => lastSale && void reprint(lastSale.id)}
            style={{ flex: 1 }}
          />
          <Button
            testID="share-whatsapp"
            label="WhatsApp"
            disabled={sharing || !lastSale}
            onPress={() => void share()}
            style={{ flex: 1 }}
          />
        </View>
        <Button testID="new-order" label="+ Pesanan baru" variant="primary" large onPress={done} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s2,
    paddingHorizontal: space.s4,
  },
  title: { color: colors.ink, fontSize: 24, fontWeight: '800' },
  total: { color: colors.orange, fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'] },
  muted: { color: colors.muted },
  change: { color: colors.greenText, fontSize: 22, fontWeight: '800' },
  actions: { padding: space.s4, gap: space.s2 },
  secondary: { flexDirection: 'row', gap: space.s2, borderRadius: radius.md },
});
