import type { Category } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../../src/auth/SessionProvider';
import type { CatalogProduct } from '../../src/catalog/repository';
import { addProduct, itemCount, payAvailability, summaryLabel } from '../../src/sales/cart';
import { qrisAvailability } from '../../src/sales/qris';
import { useSales } from '../../src/sales/SalesProvider';
import { colors, radius, space } from '../../src/theme';
import { Banner, Button, Chip, EmptyState, TopBar } from '../../src/ui/components';

export function pendingBanner(n: number): string {
  return `${n} transaksi belum tersinkron`;
}

export default function JualScreen() {
  const router = useRouter();
  const { paired, session } = useSession();
  const { catalog, catalogVersion, cart, setCart, online, pending, refreshPending, syncNow } =
    useSales();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<string>('favorit');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<CatalogProduct[] | null>(null);

  useEffect(() => {
    if (!catalog) return;
    void catalog.listCategories().then(setCategories);
  }, [catalog, catalogVersion]);

  useEffect(() => {
    if (!catalog) return;
    // A search looks across every category; chips only apply when the box is empty.
    const query = search.trim() ? { search } : { category: selected };
    void catalog.listProducts(query).then(setProducts);
  }, [catalog, catalogVersion, selected, search]);

  // Long-press = "Tandai habis" (M-14): hidden at once, synced to the owner/other devices later.
  const markSoldOut = (item: CatalogProduct) => {
    const run = async () => {
      await catalog?.setSoldOut(item.id, true, session?.employeeId ?? null);
      setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.productId !== item.id) }));
      setProducts((list) => list?.filter((p) => p.id !== item.id) ?? list);
      await refreshPending();
      void syncNow();
    };
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`Tandai "${item.name}" habis?`)) void run();
      return;
    }
    Alert.alert(
      `Tandai "${item.name}" habis?`,
      'Menu disembunyikan dari kasir sampai ditandai tersedia lagi (Shift → Menu habis).',
      [
        { text: 'Batal', style: 'cancel' },
        { text: 'Tandai habis', style: 'destructive', onPress: () => void run() },
      ],
    );
  };

  const count = itemCount(cart);
  const qris = qrisAvailability(online);
  const pay = payAvailability(cart, qris.enabled);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <TopBar
        title={`🍹 ${paired?.outlet.name ?? ''}`}
        right={
          <Text style={[styles.net, { color: online ? colors.greenText : colors.warn }]}>
            {online ? '● Online' : '● Offline'}
          </Text>
        }
      />
      {!online ? (
        <Banner tone="warn">Offline — transaksi cash tetap tersimpan dan disinkron nanti</Banner>
      ) : null}
      {pending > 0 ? <Banner tone="info">{pendingBanner(pending)}</Banner> : null}
      <View style={styles.searchRow}>
        <TextInput
          testID="search"
          value={search}
          onChangeText={setSearch}
          placeholder="Cari menu…"
          placeholderTextColor={colors.muted}
          style={styles.search}
        />
      </View>
      <View style={{ height: 52 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip
            label="⭐ Favorit"
            on={!search && selected === 'favorit'}
            onPress={() => setSelected('favorit')}
          />
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              on={!search && selected === c.id}
              onPress={() => setSelected(c.id)}
            />
          ))}
        </ScrollView>
      </View>
      {products === null ? null : products.length === 0 ? (
        <EmptyState
          icon="🍹"
          title={search ? 'Menu tidak ditemukan' : 'Belum ada menu'}
          body={
            search
              ? 'Coba kata kunci lain.'
              : 'Owner menambah menu di dashboard; menu tersinkron otomatis saat online.'
          }
        />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(p) => p.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={{ gap: space.s3 }}
          renderItem={({ item }) => {
            const inCart = cart.lines.find((l) => l.productId === item.id)?.quantity ?? 0;
            return (
              <Pressable
                testID={`product-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={`${item.name} ${formatRupiah(item.price)}`}
                onPress={() => setCart((c) => addProduct(c, item))}
                onLongPress={() => markSoldOut(item)}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
              >
                {inCart > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{inCart}</Text>
                  </View>
                ) : null}
                <Text style={styles.cardName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.cardPrice}>{formatRupiah(item.price)}</Text>
              </Pressable>
            );
          }}
        />
      )}
      <View style={styles.payBar}>
        <Pressable
          testID="cart-summary"
          accessibilityRole="button"
          disabled={count === 0}
          onPress={() => router.navigate('/keranjang')}
          style={{ flex: 1 }}
        >
          <Text style={styles.payLabel}>
            {count === 0 ? '🛒 Keranjang kosong' : `🛒 ${summaryLabel(cart, formatRupiah)}`}
          </Text>
          <Text style={styles.payHint}>
            {count === 0 ? 'Tap menu untuk menambah' : 'Ketuk untuk cek keranjang'}
          </Text>
        </Pressable>
        <Button
          testID="pay-cash"
          label="Cash"
          variant="accent"
          large
          disabled={!pay.cash}
          onPress={() => router.push('/cash')}
          style={styles.payBtn}
        />
        <Button
          testID="pay-qris"
          label="QRIS"
          variant="primary"
          large
          disabled={!pay.qris}
          onPress={() => router.push('/qris')}
          style={styles.payBtn}
        />
      </View>
      {qris.hint && count > 0 ? <Text style={styles.qrisHint}>{qris.hint}</Text> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  net: { fontSize: 13, fontWeight: '700' },
  searchRow: { paddingHorizontal: space.s4, paddingTop: space.s3 },
  search: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    color: colors.ink,
    paddingHorizontal: space.s4,
    fontSize: 16,
  },
  chips: { gap: space.s2, paddingHorizontal: space.s4, alignItems: 'center' },
  grid: { padding: space.s4, gap: space.s3 },
  card: {
    flex: 1,
    minHeight: 96,
    padding: space.s3,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'space-between',
  },
  cardName: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  cardPrice: {
    color: colors.greenText,
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    zIndex: 1,
  },
  badgeText: { color: '#fff', fontWeight: '800' },
  payBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    padding: space.s3,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  payLabel: { color: colors.ink, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  payHint: { color: colors.muted, fontSize: 12 },
  payBtn: { minWidth: 84 },
  qrisHint: {
    color: colors.warn,
    textAlign: 'center',
    fontSize: 12,
    paddingBottom: 6,
    backgroundColor: colors.surface,
  },
});
