import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../../src/auth/SessionProvider';
import { colors } from '../../src/theme';
import { EmptyState, TopBar } from '../../src/ui/components';

export default function JualScreen() {
  const { paired, shift } = useSession();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopBar title={`🍹 ${paired?.outlet.name ?? ''}`} />
      <EmptyState
        icon="🍹"
        title="Katalog segera hadir"
        body={`Shift terbuka sejak ${shift ? new Date(shift.opened_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}. Katalog dan keranjang dikerjakan di task M-2/M-6/M-8.`}
      />
    </SafeAreaView>
  );
}
