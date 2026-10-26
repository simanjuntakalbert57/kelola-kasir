import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { bluetoothTransport } from '../src/printing/bluetoothTransport';
import { COLS, renderText, testPageLines } from '../src/printing/layout';
import { usePrinter } from '../src/printing/PrinterProvider';
import type { PermissionResult, PrinterDevice } from '../src/printing/service';
import { colors, radius, space } from '../src/theme';
import { Banner, Button, TopBar } from '../src/ui/components';

const STATUS_TEXT = {
  none: 'Belum ada',
  connecting: 'Menyambungkan…',
  connected: 'Terhubung',
  disconnected: 'Terputus',
} as const;

function confirmAsk(title: string, message: string, ok: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm(`${title}\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Batal', style: 'cancel', onPress: () => resolve(false) },
      { text: ok, onPress: () => resolve(true) },
    ]),
  );
}

export default function PrinterScreen() {
  const router = useRouter();
  const { saved, status, connectTo, testPrint, reconnect, forget } = usePrinter();
  const [devices, setDevices] = useState<PrinterDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [permission, setPermission] = useState<PermissionResult | null>(null);
  const [btOff, setBtOff] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const scanId = useRef(0);

  const scan = useCallback(async () => {
    const id = ++scanId.current;
    setMessage(null);
    const granted = await bluetoothTransport.requestPermissions();
    setPermission(granted);
    if (granted !== 'granted') return;
    setBtOff(!(await bluetoothTransport.isEnabled()));
    if (!(await bluetoothTransport.isEnabled())) return;
    setScanning(true);
    const found = new Map<string, PrinterDevice>();
    const show = () => {
      if (id === scanId.current) {
        // Paired devices first: that is where the printer usually is.
        setDevices([...found.values()].sort((a, b) => Number(b.bonded) - Number(a.bonded)));
      }
    };
    try {
      for (const d of await bluetoothTransport.listBonded()) found.set(d.address, d);
      show();
      await bluetoothTransport.discover((d) => {
        found.set(d.address, { ...d, bonded: found.get(d.address)?.bonded ?? d.bonded });
        show();
      });
    } catch {
      // Discovery can fail when Bluetooth is toggled mid-scan; paired devices are still listed.
    } finally {
      if (id === scanId.current) setScanning(false);
    }
  }, []);

  const showPicker = !saved || picking;
  useEffect(() => {
    if (!showPicker) return;
    void scan();
    return () => {
      scanId.current++;
      void bluetoothTransport.cancelDiscovery();
    };
  }, [showPicker, scan]);

  const connect = async (device: PrinterDevice) => {
    setBusy(device.address);
    setMessage(null);
    await bluetoothTransport.cancelDiscovery();
    const res = await connectTo(device);
    setBusy(null);
    if (res.ok) {
      setPicking(false);
      setMessage({ tone: 'ok', text: `Terhubung ke ${device.name}.` });
    } else {
      setMessage({ tone: 'error', text: res.message });
    }
  };

  const test = async () => {
    setBusy('test');
    const res = await testPrint();
    setBusy(null);
    setMessage(
      res.ok
        ? { tone: 'ok', text: 'Printer siap dipakai ✓' }
        : { tone: 'error', text: res.message },
    );
  };

  const redo = async () => {
    setBusy('reconnect');
    const ok = await reconnect();
    setBusy(null);
    setMessage(
      ok
        ? { tone: 'ok', text: 'Terhubung kembali.' }
        : { tone: 'error', text: 'Tidak bisa menyambung.' },
    );
  };

  const disconnect = async () => {
    if (
      await confirmAsk(
        'Putuskan printer?',
        'Struk tidak akan dicetak sampai printer dipasang lagi.',
        'Putuskan',
      )
    ) {
      await forget();
      setMessage(null);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <TopBar
        title="Printer struk"
        right={<Button label="Tutup" variant="ghost" onPress={() => router.back()} />}
      />
      <View style={styles.statusRow}>
        <Text style={styles.printerName}>🖨 {saved?.name ?? 'Belum ada printer'}</Text>
        <Text
          testID="printer-status"
          style={[
            styles.status,
            { color: status === 'connected' ? colors.greenText : colors.warn },
          ]}
        >
          {status === 'connected' ? '● ' : ''}
          {STATUS_TEXT[status]}
        </Text>
      </View>
      {message ? (
        <Banner tone={message.tone === 'ok' ? 'info' : 'error'}>{message.text}</Banner>
      ) : null}

      {showPicker ? (
        <>
          {permission && permission !== 'granted' ? (
            <View style={styles.pad}>
              <Banner tone="warn">
                {permission === 'blocked'
                  ? 'Izin Bluetooth ditolak. Buka Pengaturan aplikasi lalu izinkan "Perangkat di sekitar".'
                  : 'Izin Bluetooth dibutuhkan untuk mencari printer.'}
              </Banner>
              <Button label="Izinkan Bluetooth" variant="primary" onPress={() => void scan()} />
            </View>
          ) : btOff ? (
            <View style={styles.pad}>
              <Banner tone="warn">Bluetooth HP mati. Nyalakan Bluetooth lalu pindai ulang.</Banner>
              <Button
                label="Buka pengaturan Bluetooth"
                onPress={() => bluetoothTransport.openSettings()}
              />
            </View>
          ) : (
            <FlatList
              data={devices}
              keyExtractor={(d) => d.address}
              contentContainerStyle={styles.pad}
              ListHeaderComponent={
                <Text style={styles.section}>
                  Perangkat Bluetooth {scanning ? '· 🔍 Mencari…' : ''}
                </Text>
              }
              ListEmptyComponent={
                <Text style={styles.hint}>
                  {scanning
                    ? 'Mencari…'
                    : 'Tidak ada perangkat. Hidupkan printer lalu pindai ulang.'}
                </Text>
              }
              renderItem={({ item }) => (
                <View style={styles.device}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.deviceName}>🖨 {item.name}</Text>
                    <Text style={styles.hint}>
                      {item.bonded ? 'Sudah dipasangkan' : 'Terdekat'}
                    </Text>
                  </View>
                  <Button
                    testID={`connect-${item.address}`}
                    label={busy === item.address ? 'Menyambung…' : 'Hubungkan'}
                    variant="primary"
                    disabled={busy !== null}
                    onPress={() => void connect(item)}
                  />
                </View>
              )}
              ListFooterComponent={
                <View style={{ gap: space.s2, marginTop: space.s3 }}>
                  <Text style={styles.hint}>
                    Hidupkan printer & dekatkan ≤ 2 m. Printer belum muncul? Pasangkan dulu di
                    Pengaturan Bluetooth HP.
                  </Text>
                  <Button label="Pindai ulang" disabled={scanning} onPress={() => void scan()} />
                  {saved ? (
                    <Button label="Batal" variant="ghost" onPress={() => setPicking(false)} />
                  ) : null}
                </View>
              }
            />
          )}
        </>
      ) : (
        <View style={styles.pad}>
          {status === 'connected' ? (
            <>
              <View style={styles.card}>
                <Text style={styles.deviceName}>Sambung otomatis</Text>
                <Text style={styles.hint}>Saat app dibuka & sebelum mencetak</Text>
              </View>
              <Text style={styles.section}>Pratinjau tes cetak</Text>
              <View style={styles.paper}>
                <Text style={styles.paperText}>{renderText(testPageLines())}</Text>
              </View>
              <Button
                testID="test-print"
                label={busy === 'test' ? 'Mencetak…' : '🖨 Cetak tes'}
                variant="primary"
                large
                disabled={busy !== null}
                onPress={() => void test()}
              />
              <Button label="Ganti printer" onPress={() => setPicking(true)} />
              <Button label="Putuskan" variant="ghost" onPress={() => void disconnect()} />
            </>
          ) : (
            <>
              <Banner tone="warn">
                Tidak bisa menyambung. Pastikan printer menyala, Bluetooth HP aktif, dan jarak ≤ 2
                m.
              </Banner>
              <Text style={styles.hint}>
                Coba ini:{'\n'}① Hidupkan ulang printer{'\n'}② Matikan-nyalakan Bluetooth HP{'\n'}③
                Pindai & pilih ulang printer
              </Text>
              <Text style={styles.hint}>
                ℹ Transaksi tetap bisa disimpan tanpa printer. Struk bisa dicetak ulang nanti dari
                Riwayat.
              </Text>
              <Button
                testID="reconnect"
                label={
                  busy === 'reconnect' || status === 'connecting' ? 'Menyambung…' : 'Sambung ulang'
                }
                variant="primary"
                large
                disabled={busy !== null || status === 'connecting'}
                onPress={() => void redo()}
              />
              <Button label="Pindai printer lain" onPress={() => setPicking(true)} />
              <Button label="Putuskan" variant="ghost" onPress={() => void disconnect()} />
            </>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: space.s4, gap: space.s3 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.s4,
  },
  printerName: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  status: { fontWeight: '800' },
  section: { color: colors.muted, fontWeight: '700', marginBottom: space.s2 },
  hint: { color: colors.muted, lineHeight: 20 },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    padding: space.s3,
    marginBottom: space.s2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  deviceName: { color: colors.ink, fontWeight: '700', fontSize: 16 },
  card: { padding: space.s3, borderRadius: radius.md, backgroundColor: colors.surface },
  paper: { alignSelf: 'center', backgroundColor: '#fff', padding: space.s3, borderRadius: 6 },
  paperText: {
    color: '#111',
    fontFamily: Platform.select({ android: 'monospace', default: 'Courier' }),
    fontSize: 12,
    width: COLS * 7.3,
  },
});
