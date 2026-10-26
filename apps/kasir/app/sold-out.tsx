import { formatRupiah } from '@kelola-kasir/money';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../src/auth/SessionProvider';
import type { CatalogProduct } from '../src/catalog/repository';
import { useSales } from '../src/sales/SalesProvider';
import { colors, radius, space } from '../src/theme';
import { Button, EmptyState, TopBar } from '../src/ui/components';

/** Sold-out menu (M-14): bring an item back. Marking sold-out is a long-press on the grid. */
export default function SoldOutScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { catalog, catalogVersion, refreshPending, syncNow } = useSales();
  const [items, setItems] = useState<CatalogProduct[] | null>(null);

  const load = useCallback(async () => {
    if (catalog) setItems(await catalog.listSoldOut());
  }, [catalog]);
  useEffect(() => {
    void load();
  }, [load, catalogVersion]);

  const restore = async (p: CatalogProduct) => {
    await catalog?.setSoldOut(p.id, false, session?.employeeId ?? null);
    await load();
    await refreshPending();
    void syncNow();
  };

  return (
    <SafeAreaView style={styles.root}>
      <TopBar
        title="Menu habis"
        right={<Button label="Tutup" variant="ghost" onPress={() => router.back()} />}
      />
      {items === null ? null : items.length === 0 ? (
        <EmptyState
          icon="🍹"
          title="Tidak ada menu habis"
          body="Tahan lama (long-press) sebuah menu di layar Jual untuk menandainya habis."
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: space.s4, gap: space.s2 }}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.price}>{formatRupiah(item.price)}</Text>
              </View>
              <Button
                testID={`restore-${item.id}`}
                label="Tersedia lagi"
                variant="primary"
                onPress={() => void restore(item)}
              />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    padding: space.s3,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  name: { color: colors.ink, fontWeight: '700', fontSize: 16 },
  price: { color: colors.muted },
});
