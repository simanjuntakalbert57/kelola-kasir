import { cashChange, formatRupiah } from '@kelola-kasir/money';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePrinter } from '../src/printing/PrinterProvider';
import { quickCashAmounts, totalsOf } from '../src/sales/cart';
import { createCashSale } from '../src/sales/checkout';
import { toCompleted, useSales } from '../src/sales/SalesProvider';
import { appendDigit, digitsToRupiah } from '../src/shift/prefill';
import { colors, radius, space } from '../src/theme';
import { Button, Chip, FitLayout, Keypad, ScreenContainer, TopBar } from '../src/ui/components';
import { FONT_CAP } from '../src/ui/layout';
import { useKeypadFit } from '../src/ui/useKeypadFit';
import { PrintToggle } from '../src/ui/PrintToggle';

export default function CashScreen() {
  const router = useRouter();
  const { db, cart, saleContext, completeSale, printReceipt, setPrintReceipt } = useSales();
  const { autoPrint } = usePrinter();
  const total = totalsOf(cart).total;
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { compact, scrollAll, keyHeight, onFooterLayout } = useKeypadFit({
    chromeEstimate: 200,
    bodyReserve: 200,
    compactBodyReserve: 150,
  });
  const tendered = digitsToRupiah(digits);
  const enough = tendered >= total;

  // Saved locally first (works offline); the outbox pushes it when the network is back.
  const pay = async (amount: number) => {
    if (!db || !saleContext || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sale = await createCashSale(db, saleContext, cart, amount);
      completeSale(toCompleted(sale));
      // The sale is already saved: printing runs on its own and can fail without touching it.
      if (printReceipt) autoPrint(sale.id);
      router.replace('/success');
    } catch {
      setError('Gagal menyimpan transaksi. Coba lagi.');
      setBusy(false);
    }
  };

  const footer = (
    <View style={styles.footer} onLayout={onFooterLayout}>
      <View style={styles.amountBox}>
        {compact ? null : <Text style={styles.label}>Uang diterima</Text>}
        <Text testID="cash-tendered" maxFontSizeMultiplier={FONT_CAP} style={styles.amount}>
          {formatRupiah(tendered)}
        </Text>
        <Text
          testID="cash-change"
          maxFontSizeMultiplier={FONT_CAP}
          style={[styles.change, { color: enough ? colors.greenText : colors.warn }]}
        >
          {digits === ''
            ? 'Pilih nominal atau ketik'
            : enough
              ? `Kembalian ${formatRupiah(cashChange(total, tendered))}`
              : `Kurang ${formatRupiah(total - tendered)}`}
        </Text>
      </View>
      <Keypad triple keyHeight={keyHeight} onKey={(k) => setDigits((d) => appendDigit(d, k))} />
      <Button
        testID="cash-submit"
        label={busy ? 'Menyimpan…' : 'Selesai'}
        variant="accent"
        large
        disabled={busy || !enough || !db}
        onPress={() => void pay(tendered)}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.root}>
      <ScreenContainer>
        <TopBar
          title="Bayar Cash"
          right={<Button label="Batal" variant="ghost" onPress={() => router.back()} />}
        />
        <FitLayout
          scrollAll={scrollAll}
          bodyStyle={styles.body}
          footer={footer}
          body={
            <>
              <Text style={styles.label}>Total</Text>
              <Text
                testID="cash-total"
                maxFontSizeMultiplier={FONT_CAP}
                style={[styles.total, compact && styles.totalCompact]}
              >
                {formatRupiah(total)}
              </Text>
              <Button
                testID="exact-cash"
                label={`✓ Uang Pas · ${formatRupiah(total)}`}
                variant="primary"
                large
                disabled={busy || !db}
                onPress={() => void pay(total)}
                style={{ marginTop: space.s3 }}
              />
              {compact ? null : (
                <View style={styles.quick}>
                  {quickCashAmounts(total).map((n) => (
                    <Chip
                      key={n}
                      label={formatRupiah(n)}
                      on={tendered === n}
                      onPress={() => setDigits(String(n))}
                    />
                  ))}
                </View>
              )}
              {error ? <Text style={styles.err}>{error}</Text> : null}
              <View style={{ flexGrow: 1 }} />
              <PrintToggle value={printReceipt} onChange={setPrintReceipt} />
            </>
          }
        />
      </ScreenContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flexGrow: 1, padding: space.s4, gap: space.s2 },
  footer: { padding: space.s4, paddingTop: space.s2, gap: space.s2, backgroundColor: colors.bg },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  totalCompact: { fontSize: 32 },
  total: { color: colors.orange, fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'] },
  quick: { flexDirection: 'row', gap: space.s2, flexWrap: 'wrap' },
  amountBox: { padding: space.s3, borderRadius: radius.md, backgroundColor: colors.surface },
  amount: { color: colors.ink, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  change: { fontSize: 16, fontWeight: '700' },
  err: { color: colors.danger },
});
