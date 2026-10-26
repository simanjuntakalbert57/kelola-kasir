import { formatRupiah } from '@kelola-kasir/money';
import { useRouter } from 'expo-router';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  removeLine,
  setCustomerLabel,
  setNote,
  setQuantity,
  summaryLabel,
  totalsOf,
} from '../src/sales/cart';
import { useSales } from '../src/sales/SalesProvider';
import { colors, radius, space } from '../src/theme';
import { Button, TopBar } from '../src/ui/components';

export default function CartScreen() {
  const router = useRouter();
  const { cart, setCart } = useSales();
  const total = totalsOf(cart).total;
  return (
    <SafeAreaView style={styles.root}>
      <TopBar
        title="Pesanan"
        right={<Button label="Tutup" variant="ghost" onPress={() => router.back()} />}
      />
      <FlatList
        data={[...cart.lines]}
        keyExtractor={(l) => l.productId}
        contentContainerStyle={{ padding: space.s4, gap: space.s3 }}
        ListEmptyComponent={<Text style={styles.muted}>Keranjang kosong.</Text>}
        ListFooterComponent={
          <TextInput
            testID="customer-label"
            value={cart.customerLabel}
            onChangeText={(t) => setCart((c) => setCustomerLabel(c, t))}
            placeholder="Label pembeli (opsional)"
            placeholderTextColor={colors.muted}
            maxLength={40}
            style={styles.input}
          />
        }
        renderItem={({ item }) => (
          <View style={styles.line}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.muted}>{formatRupiah(item.unitPrice)}</Text>
              </View>
              <Button
                label="−"
                onPress={() => setCart((c) => setQuantity(c, item.productId, item.quantity - 1))}
                style={styles.step}
              />
              <Text style={styles.qty}>{item.quantity}</Text>
              <Button
                label="+"
                onPress={() => setCart((c) => setQuantity(c, item.productId, item.quantity + 1))}
                style={styles.step}
              />
            </View>
            <View style={styles.row}>
              <TextInput
                value={item.note ?? ''}
                onChangeText={(t) => setCart((c) => setNote(c, item.productId, t))}
                placeholder="Catatan"
                placeholderTextColor={colors.muted}
                maxLength={140}
                style={[styles.input, { flex: 1, minHeight: 40 }]}
              />
              <Text style={styles.lineTotal}>
                {formatRupiah(totalsOf({ ...cart, lines: [item] }).total)}
              </Text>
              <Button
                label="Hapus"
                variant="ghost"
                onPress={() => setCart((c) => removeLine(c, item.productId))}
              />
            </View>
          </View>
        )}
      />
      <View style={styles.footer}>
        <Text style={styles.total}>{summaryLabel(cart, formatRupiah)}</Text>
        <Button
          label="Lanjut ke jual"
          variant="primary"
          large
          disabled={total <= 0}
          onPress={() => router.back()}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  line: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.s3,
    gap: space.s2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  name: { color: colors.ink, fontWeight: '700', fontSize: 16 },
  muted: { color: colors.muted },
  qty: { color: colors.ink, fontWeight: '800', fontSize: 18, minWidth: 32, textAlign: 'center' },
  step: { minWidth: 48, paddingHorizontal: 0 },
  lineTotal: { color: colors.greenText, fontWeight: '800', fontVariant: ['tabular-nums'] },
  input: {
    minHeight: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceAlt,
    color: colors.ink,
    paddingHorizontal: space.s3,
  },
  footer: {
    padding: space.s4,
    gap: space.s3,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  total: { color: colors.ink, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
