import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { usePrinter, type PrinterStatus } from '../printing/PrinterProvider';
import { colors, radius, space } from '../theme';

/** The four states of the toggle (design K-06/K-07): the state is read from the text, not only the colour. */
export function printToggleSubtitle(
  on: boolean,
  status: PrinterStatus,
  printerName: string | null,
): { text: string; warn: boolean } {
  if (!on) return { text: 'Mati · struk tidak dicetak', warn: false };
  if (status === 'none') return { text: 'Belum ada printer · ketuk untuk pasang', warn: true };
  if (status === 'connected')
    return { text: `Terhubung · ${printerName ?? 'Printer'}`, warn: false };
  if (status === 'connecting') return { text: 'Menyambungkan printer…', warn: false };
  return { text: 'Printer tidak tersambung · ketuk untuk atur', warn: true };
}

/**
 * "Cetak struk" toggle (K-06/K-07). Default on, remembered per device. Tapping the text opens the
 * Printer screen; a disconnected printer never blocks the payment.
 */
export function PrintToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (on: boolean) => void;
}) {
  const router = useRouter();
  const { status, saved } = usePrinter();
  const sub = printToggleSubtitle(value, status, saved?.name ?? null);
  return (
    <View style={styles.row}>
      <Pressable
        testID="print-status"
        accessibilityRole="button"
        accessibilityLabel={`Cetak struk. ${sub.text}`}
        onPress={() => router.push('/printer')}
        style={{ flex: 1 }}
      >
        <Text style={styles.title}>🖨 Cetak struk</Text>
        <Text style={[styles.sub, sub.warn && { color: colors.warn }]}>{sub.text}</Text>
      </Pressable>
      <Switch
        testID="print-toggle"
        accessibilityLabel="Cetak struk"
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.green, false: colors.line }}
        thumbColor="#fff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    padding: space.s3,
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  title: { color: colors.ink, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 12 },
});
