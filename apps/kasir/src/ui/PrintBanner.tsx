import { StyleSheet, Text, View } from 'react-native';
import type { PrintJob } from '../printing/PrinterProvider';
import { colors, radius, space } from '../theme';
import { Button } from './components';

/**
 * Print outcome under the sale (K-08 / K-08b / K-08c). Only one message shows at a time, and the
 * sale is already saved whatever it says.
 */
export function PrintBanner({
  job,
  printReceipt,
  printerName,
  connecting,
  onRetry,
  onSkip,
  onSettings,
}: {
  job: PrintJob | null;
  printReceipt: boolean;
  printerName: string | null;
  connecting: boolean;
  onRetry: () => void;
  onSkip: () => void;
  onSettings: () => void;
}) {
  if (!job) {
    return printReceipt ? null : <Pill text="Struk tidak dicetak" />;
  }
  if (job.state === 'printing') {
    return (
      <Pill testID="print-pending" text={connecting ? 'Menyambung printer…' : 'Mencetak struk…'} />
    );
  }
  if (job.state === 'done') {
    return (
      <Pill
        testID="print-done"
        tone="ok"
        text={`${job.kind === 'reprint' ? 'Cetak ulang berhasil' : 'Struk dicetak'}${printerName ? ` · ${printerName}` : ''}`}
      />
    );
  }
  const writeFailed = job.reason === 'write_failed';
  return (
    <View testID="print-error" style={[styles.box, writeFailed ? styles.err : styles.warn]}>
      <Text style={[styles.title, { color: writeFailed ? colors.danger : colors.warn }]}>
        {writeFailed ? '⚠ Gagal mencetak' : '🖨 Printer tidak tersambung'}
      </Text>
      <Text style={styles.body}>
        {writeFailed ? job.message : `Transaksi sudah tersimpan. ${job.message ?? ''}`}
      </Text>
      <View style={styles.row}>
        <Button
          testID="print-retry"
          label={writeFailed ? 'Cetak ulang' : 'Coba lagi'}
          variant="primary"
          onPress={onRetry}
          style={{ flex: 1 }}
        />
        <Button testID="print-skip" label="Lewati" onPress={onSkip} style={{ flex: 1 }} />
      </View>
      {!writeFailed ? (
        <Text accessibilityRole="link" onPress={onSettings} style={styles.link}>
          Buka pengaturan printer ›
        </Text>
      ) : null}
    </View>
  );
}

function Pill({ text, tone, testID }: { text: string; tone?: 'ok'; testID?: string }) {
  return (
    <View
      testID={testID}
      style={[styles.pill, tone === 'ok' && { backgroundColor: colors.greenBg }]}
    >
      <Text style={{ color: tone === 'ok' ? colors.greenText : colors.muted, fontWeight: '700' }}>
        🖨 {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    marginTop: space.s3,
    paddingHorizontal: space.s3,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  box: {
    alignSelf: 'stretch',
    marginTop: space.s3,
    padding: space.s3,
    borderRadius: radius.md,
    gap: space.s2,
  },
  warn: { backgroundColor: colors.warnBg },
  err: { backgroundColor: colors.dangerBg },
  title: { fontWeight: '800', fontSize: 16 },
  body: { color: colors.ink },
  row: { flexDirection: 'row', gap: space.s2 },
  link: { color: colors.info, fontWeight: '700', paddingVertical: 4 },
});
