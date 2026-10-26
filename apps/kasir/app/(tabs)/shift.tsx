import { formatRupiah } from '@kelola-kasir/money';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../../src/auth/SessionProvider';
import { colors, radius, space } from '../../src/theme';
import { Banner, Button, TopBar } from '../../src/ui/components';

export default function ShiftScreen() {
  const { session, shift, paired, logout } = useSession();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
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
        <Text style={styles.note}>
          Tutup shift dan printer struk dikerjakan di task M-13 / M-11.
        </Text>
        <View style={{ flex: 1 }} />
        <Button label="Ganti pegawai (keluar)" onPress={logout} large />
      </View>
    </SafeAreaView>
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
  body: { flex: 1, padding: space.s4 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.s4,
    gap: space.s3,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: colors.muted },
  rowValue: { color: colors.ink, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 13, marginTop: space.s3 },
});
