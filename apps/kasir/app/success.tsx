import { formatRupiah } from '@kelola-kasir/money';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSales } from '../src/sales/SalesProvider';
import { colors, space } from '../src/theme';
import { Banner, Button } from '../src/ui/components';

export default function SuccessScreen() {
  const router = useRouter();
  const { lastSale, newOrder, pending, online } = useSales();
  const done = () => {
    newOrder();
    router.replace('/jual');
  };
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
        <Text style={styles.title}>Lunas</Text>
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
      </View>
      <View style={{ padding: space.s4 }}>
        <Button testID="new-order" label="+ Pesanan baru" variant="primary" large onPress={done} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s2 },
  title: { color: colors.ink, fontSize: 24, fontWeight: '800' },
  total: { color: colors.orange, fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'] },
  muted: { color: colors.muted },
  change: { color: colors.greenText, fontSize: 22, fontWeight: '800' },
});
