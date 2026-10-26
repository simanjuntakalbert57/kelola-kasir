import type { TransactionSummary } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../../src/auth/SessionProvider';
import { formatTime, shortNumber } from '../../src/printing/layout';
import { usePrinter } from '../../src/printing/PrinterProvider';
import {
  canReprint,
  filterByMethod,
  listLocalHistory,
  mergeRemote,
  STATUS_LABEL,
  storeRemoteStatuses,
  type HistoryRow,
  type HistoryScope,
  type MethodFilter,
} from '../../src/sales/history';
import { useSales } from '../../src/sales/SalesProvider';
import { colors, radius, space } from '../../src/theme';
import { Banner, Chip, EmptyState, TopBar } from '../../src/ui/components';

const STATUS_COLOR: Record<string, string> = {
  paid: colors.greenText,
  void_requested: colors.warn,
  voided: colors.danger,
  cancelled: colors.muted,
  pending: colors.info,
};

export default function RiwayatScreen() {
  const router = useRouter();
  const { api, session, shift, paired } = useSession();
  const { db, pending } = useSales();
  const { reprint } = usePrinter();
  const [scope, setScope] = useState<HistoryScope>('shift');
  const [method, setMethod] = useState<MethodFilter>('all');
  const [local, setLocal] = useState<HistoryRow[] | null>(null);
  const [remote, setRemote] = useState<TransactionSummary[]>([]);
  const [remoteFailed, setRemoteFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const timeZone = paired?.outlet.timezone ?? 'Asia/Jakarta';

  const load = useCallback(async () => {
    if (!db || !shift) return;
    setLocal(await listLocalHistory(db, { scope, shiftId: shift.id, timeZone }));
    // Other devices' sales and owner decisions come from the server; offline we show this device only.
    if (!session?.accessToken) return setRemoteFailed(true);
    try {
      const res = await api.listTransactions(scope);
      await storeRemoteStatuses(db, res.data);
      setRemote(res.data);
      setRemoteFailed(false);
      setLocal(await listLocalHistory(db, { scope, shiftId: shift.id, timeZone }));
    } catch {
      setRemoteFailed(true);
    }
  }, [api, db, session, shift, scope, timeZone]);

  // Reload on focus, when the scope changes and when the outbox drains.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, pending]),
  );

  const rows = local ? filterByMethod(mergeRemote(local, remote), method) : null;

  const print = async (row: HistoryRow) => {
    if (!row.local) return router.push(`/transaction/${row.id}`);
    const res = await reprint(row.id);
    setNotice(
      res.ok
        ? { tone: 'info', text: `Cetak ulang ${shortNumber(row.number)} berhasil` }
        : { tone: 'error', text: res.message },
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <TopBar title={scope === 'shift' ? 'Riwayat shift ini' : 'Riwayat hari ini'} />
      {remoteFailed ? (
        <Banner tone="warn">Menampilkan transaksi perangkat ini (server tidak terjangkau)</Banner>
      ) : null}
      {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}
      <View style={styles.filters}>
        {(['all', 'cash', 'qris'] as const).map((m) => (
          <Chip
            key={m}
            label={m === 'all' ? 'Semua' : m === 'cash' ? 'Cash' : 'QRIS'}
            on={method === m}
            onPress={() => setMethod(m)}
          />
        ))}
        <View style={{ flex: 1 }} />
        <Chip
          label={scope === 'shift' ? 'Shift ini' : 'Hari ini'}
          on
          onPress={() => setScope(scope === 'shift' ? 'today' : 'shift')}
        />
      </View>
      {rows === null ? null : rows.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="Belum ada transaksi"
          body={
            method === 'all'
              ? 'Transaksi akan muncul di sini setelah ada penjualan.'
              : 'Tidak ada transaksi dengan filter ini.'
          }
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.greenText}
              onRefresh={() => {
                setRefreshing(true);
                void load().finally(() => setRefreshing(false));
              }}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`history-${item.id}`}
              accessibilityRole="button"
              onPress={() => router.push(`/transaction/${item.id}`)}
              style={styles.row}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.number}>
                  {shortNumber(item.number)} · {formatTime(item.createdAt, timeZone)}
                </Text>
                <Text style={styles.meta}>
                  {item.itemCount} item · {item.method === 'cash' ? 'Cash' : 'QRIS'} ·{' '}
                  {item.employeeName}
                </Text>
                <View style={styles.badges}>
                  <Text
                    style={[styles.badge, { color: STATUS_COLOR[item.status] ?? colors.muted }]}
                  >
                    {STATUS_LABEL[item.status] ?? item.status}
                  </Text>
                  {item.sync === 'pending' ? (
                    <Text testID="badge-unsynced" style={[styles.badge, { color: colors.warn }]}>
                      ⏳ Belum sinkron
                    </Text>
                  ) : null}
                  {item.sync === 'rejected' ? (
                    <Text style={[styles.badge, { color: colors.danger }]}>⚠ Ditolak server</Text>
                  ) : null}
                </View>
              </View>
              <Text style={styles.amount}>{formatRupiah(item.total)}</Text>
              {canReprint(item.status) ? (
                <Pressable
                  testID={`reprint-${item.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Cetak ulang ${shortNumber(item.number)}`}
                  onPress={() => void print(item)}
                  style={styles.printBtn}
                >
                  <Text style={{ fontSize: 20 }}>🖨</Text>
                </Pressable>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  filters: { flexDirection: 'row', gap: space.s2, padding: space.s3, alignItems: 'center' },
  list: { padding: space.s4, gap: space.s2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    minHeight: 72,
    padding: space.s3,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  number: { color: colors.ink, fontWeight: '800', fontSize: 16 },
  meta: { color: colors.muted, fontSize: 13 },
  badges: { flexDirection: 'row', gap: space.s3, flexWrap: 'wrap' },
  badge: { fontSize: 12, fontWeight: '800' },
  amount: { color: colors.ink, fontWeight: '800', fontVariant: ['tabular-nums'] },
  printBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
