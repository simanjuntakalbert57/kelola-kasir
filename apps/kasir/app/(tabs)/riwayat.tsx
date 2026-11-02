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
  fromServerSummary,
  listLocalHistory,
  mergeRemote,
  STATUS_LABEL,
  storeRemoteStatuses,
  summarizeRows,
  type HistoryRow,
  type HistoryScope,
  type MethodFilter,
  type SalesSummary,
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
  const [serverSummary, setServerSummary] = useState<SalesSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const timeZone = paired?.outlet.timezone ?? 'Asia/Jakarta';

  const load = useCallback(async () => {
    if (!db || !shift) return;
    setLocal(await listLocalHistory(db, { scope, shiftId: shift.id, timeZone }));
    // Other devices' sales and owner decisions come from the server; offline we show this device only.
    if (!session?.accessToken) {
      setServerSummary(null);
      return setRemoteFailed(true);
    }
    try {
      // Totals come from the server: the list above is paged and would undercount.
      const [res, totals] = await Promise.all([
        api.listTransactions(scope),
        api.getTransactionsSummary(scope),
      ]);
      setServerSummary(fromServerSummary(totals));
      await storeRemoteStatuses(db, res.data);
      setRemote(res.data);
      setRemoteFailed(false);
      setLocal(await listLocalHistory(db, { scope, shiftId: shift.id, timeZone }));
    } catch {
      setServerSummary(null);
      setRemoteFailed(true);
    }
  }, [api, db, session, shift, scope, timeZone]);

  // Reload on focus, when the scope changes and when the outbox drains.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, pending]),
  );

  // Offline: totals from this phone only, and the card says so.
  const summary =
    remoteFailed || !serverSummary ? (local ? summarizeRows(local) : null) : serverSummary;
  const summaryLocalOnly = remoteFailed || !serverSummary;

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
      {summary ? (
        <SummaryCard summary={summary} scope={scope} localOnly={summaryLocalOnly} />
      ) : null}
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

function SummaryCard({
  summary,
  scope,
  localOnly,
}: {
  summary: SalesSummary;
  scope: HistoryScope;
  localOnly: boolean;
}) {
  return (
    <View testID="summary-card" style={styles.summary}>
      <Text style={styles.summaryLabel}>
        {scope === 'shift' ? 'Penjualan shift ini' : 'Penjualan hari ini'}
      </Text>
      <Text testID="summary-total" style={styles.summaryTotal}>
        {formatRupiah(summary.totalSales)}
      </Text>
      <Text style={styles.meta}>{summary.transactionCount} transaksi</Text>
      <View style={styles.summaryMethods}>
        <Text testID="summary-cash" style={styles.summaryMethod}>
          Cash {formatRupiah(summary.cashSales)} ({summary.cashCount})
        </Text>
        <Text testID="summary-qris" style={styles.summaryMethod}>
          QRIS {formatRupiah(summary.qrisSales)} ({summary.qrisCount})
        </Text>
      </View>
      {summary.pendingVoidCount > 0 ? (
        <Text testID="summary-pending-void" style={[styles.badge, { color: colors.warn }]}>
          {summary.pendingVoidCount} void menunggu · {formatRupiah(summary.pendingVoidAmount)}
        </Text>
      ) : null}
      {localOnly ? (
        <Text testID="summary-offline" style={[styles.badge, { color: colors.warn }]}>
          Hanya dari HP ini (offline)
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    marginHorizontal: space.s4,
    marginBottom: space.s2,
    padding: space.s4,
    gap: space.s1,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  summaryLabel: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  summaryTotal: {
    color: colors.greenText,
    fontSize: 28,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  summaryMethods: { flexDirection: 'row', gap: space.s4, flexWrap: 'wrap' },
  summaryMethod: { color: colors.ink, fontSize: 14, fontWeight: '700' },
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
