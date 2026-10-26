import { formatRupiah } from '@kelola-kasir/money';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../../src/auth/SessionProvider';
import { usePrinter } from '../../src/printing/PrinterProvider';
import { useSales } from '../../src/sales/SalesProvider';
import { colors, radius, space } from '../../src/theme';
import { Banner, Button, TopBar } from '../../src/ui/components';

const PRINTER_TEXT = {
  none: 'Belum ada printer',
  connecting: 'Menyambungkan…',
  connected: 'Terhubung',
  disconnected: 'Terputus',
} as const;

export default function ShiftScreen() {
  const router = useRouter();
  const { session, shift, paired, logout } = useSession();
  const { pending } = useSales();
  const { status, saved } = usePrinter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <TopBar title="Shift" />
      {session?.offline ? <Banner tone="warn">Offline — sesi memakai PIN tersimpan</Banner> : null}
      <View style={styles.body}>
        <View style={styles.card}>
          <Row label="Gerai" value={paired?.outlet.name ?? '-'} />
          <Row
            label="Perangkat"
            value={paired ? `${paired.device.name} (${paired.device.code})` : '-'}
          />
          <Row label="Kasir" value={session?.employeeName ?? '-'} />
          <Row label="Dibuka oleh" value={shift?.opened_by.name ?? '-'} />
          <Row label="Modal awal" value={shift ? formatRupiah(shift.opening_cash) : '-'} />
        </View>
        <Link
          testID="open-printer"
          title="🖨 Printer struk"
          sub={saved ? `${saved.name} · ${PRINTER_TEXT[status]}` : PRINTER_TEXT.none}
          onPress={() => router.push('/printer')}
        />
        <Link
          testID="open-sold-out"
          title="🚫 Menu habis"
          sub="Tandai menu habis atau tersedia lagi"
          onPress={() => router.push('/sold-out')}
        />
        {pending > 0 ? (
          <Banner tone="info">{`${pending} transaksi belum tersinkron`}</Banner>
        ) : null}
        <View style={{ flex: 1 }} />
        <Button
          testID="close-shift"
          label="Tutup shift"
          variant="accent"
          large
          onPress={() => router.push('/close-shift')}
        />
        <Button
          label="Ganti pegawai (keluar)"
          onPress={logout}
          large
          style={{ marginTop: space.s2 }}
        />
      </View>
    </SafeAreaView>
  );
}

function Link({
  title,
  sub,
  onPress,
  testID,
}: {
  title: string;
  sub: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.card, styles.link]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowValue}>{title}</Text>
        <Text style={styles.rowLabel}>{sub}</Text>
      </View>
      <Text style={styles.rowLabel}>›</Text>
    </Pressable>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: space.s4, gap: space.s3 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.s4,
    gap: space.s3,
  },
  link: { flexDirection: 'row', alignItems: 'center', minHeight: 64 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: colors.muted },
  rowValue: { color: colors.ink, fontWeight: '700' },
});
