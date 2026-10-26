import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../src/theme';
import { EmptyState, TopBar } from '../../src/ui/components';

export default function RiwayatScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopBar title="Riwayat shift ini" />
      <EmptyState
        icon="🧾"
        title="Belum ada transaksi"
        body="Transaksi shift ini akan muncul di sini (task M-12)."
      />
    </SafeAreaView>
  );
}
