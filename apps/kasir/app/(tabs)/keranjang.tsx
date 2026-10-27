import { formatRupiah } from '@kelola-kasir/money';
import { useRouter } from 'expo-router';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  clearCartIfConfirmed,
  itemCount,
  NOTE_MAX,
  payAvailability,
  removeLine,
  setCustomerLabel,
  setNote,
  setQuantity,
  summaryLabel,
  totalsOf,
} from '../../src/sales/cart';
import { qrisAvailability } from '../../src/sales/qris';
import { useSales } from '../../src/sales/SalesProvider';
import { colors, radius, space } from '../../src/theme';
import { Button, EmptyState, TopBar } from '../../src/ui/components';

function confirmClear(summary: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(globalThis.confirm(`Kosongkan keranjang? ${summary} akan dihapus.`));
  }
  return new Promise((resolve) => {
    Alert.alert(
      'Kosongkan keranjang?',
      `${summary} akan dihapus, termasuk catatan dan nama pembeli.`,
      [
        { text: 'Batal', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Kosongkan', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export default function KeranjangScreen() {
  const router = useRouter();
  const { cart, setCart, online } = useSales();
  const count = itemCount(cart);
  const qris = qrisAvailability(online);
  const pay = payAvailability(cart, qris.enabled);

  const onClear = async () => {
    const next = await clearCartIfConfirmed(cart, () =>
      confirmClear(summaryLabel(cart, formatRupiah)),
    );
    if (next !== cart) setCart(() => next);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <TopBar
          title={`🛒 Keranjang${count > 0 ? ` (${count})` : ''}`}
          right={
            count > 0 ? (
              <Button
                testID="clear-cart"
                label="Kosongkan"
                variant="ghost"
                onPress={() => void onClear()}
              />
            ) : undefined
          }
        />
        {count === 0 ? (
          <EmptyState
            icon="🛒"
            title="Keranjang kosong"
            body="Ketuk menu di tab Jual untuk memulai pesanan."
            action={
              <Button
                testID="pick-menu"
                label="Pilih menu"
                variant="primary"
                onPress={() => router.navigate('/jual')}
              />
            }
          />
        ) : (
          <FlatList
            style={{ flex: 1 }}
            data={[...cart.lines]}
            keyExtractor={(l) => l.productId}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: space.s4, gap: space.s3 }}
            ListHeaderComponent={
              <TextInput
                testID="customer-label"
                value={cart.customerLabel}
                onChangeText={(t) => setCart((c) => setCustomerLabel(c, t))}
                placeholder="Nama pembeli (opsional)"
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
                  <Text style={styles.lineTotal} numberOfLines={1} adjustsFontSizeToFit>
                    {formatRupiah(totalsOf({ ...cart, lines: [item] }).total)}
                  </Text>
                  <Button
                    label="−"
                    onPress={() =>
                      setCart((c) => setQuantity(c, item.productId, item.quantity - 1))
                    }
                    style={styles.step}
                  />
                  <Text style={styles.qty}>{item.quantity}</Text>
                  <Button
                    label="+"
                    onPress={() =>
                      setCart((c) => setQuantity(c, item.productId, item.quantity + 1))
                    }
                    style={styles.step}
                  />
                </View>
                <View style={styles.row}>
                  <TextInput
                    value={item.note ?? ''}
                    onChangeText={(t) => setCart((c) => setNote(c, item.productId, t))}
                    placeholder="Catatan"
                    placeholderTextColor={colors.muted}
                    maxLength={NOTE_MAX}
                    style={[styles.input, { flex: 1, minHeight: 40 }]}
                  />
                  <Button
                    label="Hapus"
                    variant="ghost"
                    onPress={() => setCart((c) => removeLine(c, item.productId))}
                  />
                </View>
              </View>
            )}
          />
        )}
        <View style={styles.footer}>
          <Text style={styles.total}>{summaryLabel(cart, formatRupiah)}</Text>
          <View style={styles.row}>
            <Button
              testID="pay-cash"
              label="Cash"
              variant="accent"
              large
              disabled={!pay.cash}
              onPress={() => router.push('/cash')}
              style={{ flex: 1 }}
            />
            <Button
              testID="pay-qris"
              label="QRIS"
              variant="primary"
              large
              disabled={!pay.qris}
              onPress={() => router.push('/qris')}
              style={{ flex: 1 }}
            />
          </View>
          {qris.hint && count > 0 ? <Text style={styles.hint}>{qris.hint}</Text> : null}
        </View>
      </KeyboardAvoidingView>
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
  lineTotal: {
    flexShrink: 0,
    minWidth: 80,
    textAlign: 'right',
    color: colors.greenText,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
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
  hint: { color: colors.warn, textAlign: 'center', fontSize: 12 },
});
