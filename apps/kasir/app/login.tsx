import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../src/api/client';
import { getLockStatus, loadEmployees, type CachedEmployee } from '../src/auth/flows';
import { useSession } from '../src/auth/SessionProvider';
import { PIN_LENGTH } from '../src/config';
import { secureStore } from '../src/lib/secureStore';
import { colors, space } from '../src/theme';
import { Banner, Button, Chip, Keypad, PinDots } from '../src/ui/components';

export default function LoginScreen() {
  const { api, paired, login, resetDevice } = useSession();
  const [employees, setEmployees] = useState<CachedEmployee[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<CachedEmployee | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await loadEmployees(api, secureStore);
      setEmployees(res.employees);
      setOffline(res.fromCache);
      setSelected((cur) => cur ?? res.employees[0] ?? null);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DEVICE_REVOKED') {
        await resetDevice();
        return;
      }
      setLoadError(true);
    }
  }, [api, resetDevice]);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (employee: CachedEmployee) => {
    setSelected(employee);
    setPin('');
    const status = await getLockStatus(secureStore, employee.id, Date.now());
    setLocked(status.locked);
    setMessage(
      status.locked
        ? `PIN terkunci. Coba lagi dalam ${Math.max(1, Math.ceil(status.remainingMs / 60_000))} menit.`
        : null,
    );
  };

  const onKey = async (key: string) => {
    if (!selected || busy || locked) return;
    if (key === '⌫') return setPin((p) => p.slice(0, -1));
    const next = (pin + key).slice(0, PIN_LENGTH);
    setPin(next);
    if (next.length < PIN_LENGTH) return;
    // Auto-submit at the 6th digit (K-01).
    setBusy(true);
    setMessage(null);
    try {
      const result = await login(selected, next);
      if (!result.ok) {
        setMessage(result.message);
        setLocked(result.reason === 'locked');
        setPin('');
      }
    } catch {
      setMessage('Terjadi kesalahan. Coba lagi.');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const noDevice = employees !== null && employees.length === 0;

  return (
    <SafeAreaView style={styles.root}>
      {offline ? <Banner tone="warn">Offline — login memakai data tersimpan</Banner> : null}
      <View style={styles.body}>
        <View style={styles.head}>
          <Text style={styles.emoji}>🍹</Text>
          <Text style={styles.title}>{paired?.outlet.name ?? 'Kelola Kasir'}</Text>
          <Text style={styles.sub}>Pilih nama, lalu masukkan PIN</Text>
        </View>

        {loadError ? (
          <View style={styles.center}>
            <Text style={styles.sub}>Tidak bisa memuat daftar pegawai.</Text>
            <Button label="Coba lagi" onPress={load} />
          </View>
        ) : employees === null ? (
          <Text style={styles.sub}>Memuat…</Text>
        ) : noDevice ? (
          <View style={styles.center}>
            <Text style={styles.sub}>
              Belum ada pegawai aktif. Hubungi owner untuk menambahkan pegawai dan PIN.
            </Text>
            <Button label="Muat ulang" onPress={load} />
          </View>
        ) : (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              style={{ flexGrow: 0 }}
            >
              {employees.map((e) => (
                <Chip
                  key={e.id}
                  label={e.name}
                  on={selected?.id === e.id}
                  onPress={() => choose(e)}
                />
              ))}
            </ScrollView>
            <PinDots length={PIN_LENGTH} filled={pin.length} />
            <Keypad onKey={onKey} disabled={busy || locked} />
            <Text
              testID="login-message"
              style={[styles.msg, message ? null : { opacity: 0 }]}
              accessibilityLiveRegion="polite"
            >
              {message ?? ' '}
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, paddingHorizontal: space.s5, justifyContent: 'center' },
  head: { alignItems: 'center' },
  emoji: { fontSize: 56 },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800', marginTop: 4 },
  sub: { color: colors.muted, textAlign: 'center', marginVertical: space.s2, lineHeight: 20 },
  chips: { gap: 8, justifyContent: 'center', flexGrow: 1, marginTop: space.s4 },
  center: { alignItems: 'center', gap: space.s3, marginTop: space.s5 },
  msg: { color: colors.danger, textAlign: 'center', marginTop: space.s3, minHeight: 20 },
});
