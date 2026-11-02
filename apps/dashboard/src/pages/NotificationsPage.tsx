import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NotificationPrefs,
  PushConfig,
  PushSubscription as ServerSubscription,
} from '@kelola-kasir/contracts';
import { Bell, Hourglass, Send, ShieldOff } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  PageHeader,
  Skeleton,
  Switch,
  Toast,
} from '../components/ui';
import { ApiError, api, patch, post } from '../lib/api';
import { errorMessage, formatDateTime } from '../lib/format';
import {
  currentSubscription,
  getStoredSubscriptionId,
  pushSupported,
  registerOnServer,
  showEnabledNotification,
  subscribeBrowser,
  unsubscribeBrowser,
} from '../lib/push';

export const PUSH_KEYS = {
  config: ['push-config'],
  subscriptions: ['push-subscriptions'],
  prefs: ['notification-prefs'],
} as const;

type Permission = NotificationPermission | 'unsupported';
type TestState = { kind: 'idle' | 'sending' } | { kind: 'ok' | 'error'; message: string };

const readPermission = (): Permission =>
  pushSupported() ? Notification.permission : 'unsupported';

/** Browser notification permission; follows changes made in the browser UI without a reload (B.5). */
function usePermission(): [Permission, () => void] {
  const [permission, setPermission] = useState<Permission>(readPermission);
  const refresh = useCallback(() => setPermission(readPermission()), []);
  useEffect(() => {
    if (!pushSupported() || !navigator.permissions) return;
    let status: PermissionStatus | undefined;
    let cancelled = false;
    navigator.permissions
      .query({ name: 'notifications' })
      .then((s) => {
        if (cancelled) return;
        status = s;
        s.onchange = refresh;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, [refresh]);
  return [permission, refresh];
}

function StatusLine({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'ok' | 'off' | 'warn' | 'info';
}) {
  return (
    <div role="status" className="mb-1">
      <Badge tone={tone}>{children}</Badge>
    </div>
  );
}

function BlockedGuide() {
  return (
    <div className="mt-3 rounded-2xl bg-tint p-3.5 text-[13px] text-tint-ink">
      <p className="font-extrabold">Chrome / Edge (Windows &amp; macOS)</p>
      <ol className="ml-5 list-decimal">
        <li>Klik ikon pengaturan situs (🔒) di kiri bilah alamat.</li>
        <li>
          Ubah <b>Notifikasi</b> menjadi <b>Izinkan</b>.
        </li>
        <li>Muat ulang halaman ini.</li>
      </ol>
      <p className="mt-2 font-extrabold">macOS</p>
      <p>
        Pengaturan Sistem → Notifikasi → Google Chrome (atau Edge) → aktifkan{' '}
        <b>Izinkan notifikasi</b>.
      </p>
      <p className="mt-2 font-extrabold">Windows</p>
      <p>
        Pengaturan → Sistem → Notifikasi → pastikan browser aktif dan mode Fokus/Jangan Ganggu mati.
      </p>
      <Button className="mt-3" small onClick={() => window.location.reload()}>
        Muat ulang halaman
      </Button>
    </div>
  );
}

function BrowserCard({
  config,
  subscriptions,
  permission,
  refreshPermission,
  localSubscribed,
  onLocalChange,
  onToast,
}: {
  config: PushConfig;
  subscriptions: ServerSubscription[];
  permission: Permission;
  refreshPermission: () => void;
  localSubscribed: boolean;
  onLocalChange: () => void;
  onToast: (message: string) => void;
}) {
  const qc = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const thisId = getStoredSubscriptionId();
  const mine = thisId ? subscriptions.find((s) => s.id === thisId) : undefined;
  const active = permission === 'granted' && localSubscribed && mine?.status === 'active';
  const needsReregister = permission === 'granted' && !active;

  const enable = async () => {
    if (!config.vapid_public_key) return;
    setError(null);
    setWaiting(true);
    try {
      if (Notification.permission !== 'granted') {
        const answer = await Notification.requestPermission();
        refreshPermission();
        if (answer !== 'granted') return;
      }
      const sub = await subscribeBrowser(config.vapid_public_key);
      await registerOnServer(sub);
      await qc.invalidateQueries({ queryKey: PUSH_KEYS.subscriptions });
      onLocalChange();
      onToast('Notifikasi diaktifkan');
      void showEnabledNotification().catch(() => undefined);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'INVALID_PUSH_SUBSCRIPTION'
          ? 'Browser ini tidak bisa didaftarkan untuk notifikasi.'
          : `Gagal mengaktifkan notifikasi. ${errorMessage(e)}`,
      );
    } finally {
      setWaiting(false);
    }
  };

  const sendTest = async () => {
    if (!mine) return;
    setTest({ kind: 'sending' });
    try {
      await post(`/notifications/push/subscriptions/${mine.id}/test`);
      setTest({ kind: 'ok', message: 'Notifikasi uji terkirim. Cek pojok layar laptop Anda.' });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NOTIFICATION_SUBSCRIPTION_GONE') {
        // The server flagged this browser as expired; the card switches to "Daftarkan ulang".
        setTest({ kind: 'idle' });
        await qc.invalidateQueries({ queryKey: PUSH_KEYS.subscriptions });
        return;
      }
      setTest({
        kind: 'error',
        message:
          e instanceof ApiError && e.status === 429
            ? 'Tunggu beberapa detik sebelum mengirim notifikasi uji lagi.'
            : e instanceof ApiError && e.status === 503
              ? 'Notifikasi belum tersedia di server.'
              : 'Notifikasi uji gagal. Periksa pengaturan notifikasi sistem Anda, lalu coba lagi.',
      });
    }
  };

  let body: ReactNode;
  if (permission === 'unsupported') {
    body = (
      <>
        <StatusLine tone="off">Tidak didukung</StatusLine>
        <p className="text-sm text-muted">
          Browser ini belum mendukung notifikasi. Buka dashboard di <b>Chrome</b> atau <b>Edge</b>{' '}
          versi terbaru di laptop.
        </p>
      </>
    );
  } else if (!config.configured) {
    body = (
      <>
        <StatusLine tone="info">Belum tersedia</StatusLine>
        <p className="text-sm text-muted">
          Notifikasi belum diaktifkan di server. Hubungi tim Kelola Kasir.
        </p>
      </>
    );
  } else if (permission === 'denied') {
    body = (
      <>
        <div role="status" className="mb-1 flex items-center gap-1.5 font-extrabold text-need-ink">
          <ShieldOff size={18} aria-hidden="true" /> Diblokir
        </div>
        <p className="text-sm text-muted">
          Notifikasi diblokir di browser ini. Buka blokir dulu, lalu muat ulang halaman.
        </p>
        <BlockedGuide />
      </>
    );
  } else if (active) {
    body = (
      <>
        <StatusLine tone="ok">Aktif di browser ini</StatusLine>
        <p className="text-sm text-muted">
          Browser ini akan menampilkan notifikasi sesuai pilihan di bawah.
        </p>
        <div className="mt-3">
          <Button
            variant="secondary"
            disabled={test.kind === 'sending'}
            onClick={() => void sendTest()}
            className="max-md:w-full"
          >
            <Send size={18} aria-hidden="true" />
            {test.kind === 'sending' ? 'Mengirim…' : 'Kirim notifikasi uji'}
          </Button>
        </div>
        {test.kind === 'ok' ? (
          <p
            role="status"
            className="mt-2.5 rounded-2xl bg-ok-bg px-3 py-2.5 text-[13px] font-bold text-ok-ink"
          >
            {test.message}
          </p>
        ) : null}
        {test.kind === 'error' ? (
          <div className="mt-2.5">
            <Alert>{test.message}</Alert>
          </div>
        ) : null}
      </>
    );
  } else if (waiting) {
    body = (
      <>
        <StatusLine tone="info">Menunggu izin Anda</StatusLine>
        <p className="text-sm text-muted">
          Jawab kotak izin dari browser di dekat bilah alamat, lalu pilih <b>Izinkan</b>.
        </p>
        <div className="mt-3">
          <Button variant="primary" disabled className="max-md:w-full">
            <Hourglass size={18} aria-hidden="true" /> Menunggu izin…
          </Button>
        </div>
        <p className="mt-2 inline-block rounded-xl border-2 border-dashed border-line-strong px-3 py-1.5 text-[13px] font-bold">
          ↖ Kotak izin tampil di kiri atas bilah alamat
        </p>
      </>
    );
  } else {
    body = (
      <>
        <StatusLine tone="off">Belum aktif</StatusLine>
        {needsReregister ? (
          <p className="mb-2 text-sm font-bold text-warm-ink">
            Browser ini belum terdaftar lagi. Daftarkan ulang browser ini.
          </p>
        ) : null}
        <p className="text-sm text-muted">
          Dapatkan pop-up di laptop setiap ada transaksi masuk. Browser akan meminta izin; pilih{' '}
          <b>Izinkan</b>. Gratis. Notifikasi muncul selama Chrome/Edge berjalan, meski tab dashboard
          ditutup. Laptop tidur: notifikasi tertahan dan muncul saat laptop aktif lagi.
        </p>
        <div className="mt-3">
          <Button variant="primary" onClick={() => void enable()} className="max-md:w-full">
            <Bell size={18} aria-hidden="true" />
            {needsReregister ? 'Daftarkan ulang browser ini' : 'Aktifkan notifikasi di browser ini'}
          </Button>
        </div>
      </>
    );
  }

  return (
    <Card>
      <h2 className="mb-1 text-lg">Notifikasi di browser ini</h2>
      {body}
      {error ? (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      ) : null}
    </Card>
  );
}

function DevicesCard({
  subscriptions,
  permission,
  localSubscribed,
  onLocalChange,
  onToast,
}: {
  subscriptions: ServerSubscription[];
  permission: Permission;
  localSubscribed: boolean;
  onLocalChange: () => void;
  onToast: (message: string) => void;
}) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<ServerSubscription | null>(null);
  const thisId = getStoredSubscriptionId();
  const revoke = useMutation({
    mutationFn: async (sub: ServerSubscription) => {
      await api(`/notifications/push/subscriptions/${sub.id}`, { method: 'DELETE' });
      if (sub.id === thisId) await unsubscribeBrowser();
    },
    onSuccess: async () => {
      setTarget(null);
      await qc.invalidateQueries({ queryKey: PUSH_KEYS.subscriptions });
      onLocalChange();
      onToast('Perangkat dicabut');
    },
  });
  return (
    <Card>
      <h2 className="text-lg">Perangkat terdaftar</h2>
      <p className="mb-2 text-sm text-muted">Browser yang menerima notifikasi.</p>
      {subscriptions.length === 0 ? (
        <p className="py-2 text-sm text-muted">Belum ada browser yang terdaftar.</p>
      ) : (
        <ul>
          {subscriptions.map((s) => {
            const isMine = s.id === thisId;
            const inactive =
              s.status === 'expired' || (isMine && (permission === 'denied' || !localSubscribed));
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0"
              >
                <div className="min-w-0">
                  <b className="flex flex-wrap items-center gap-2">
                    {s.label}
                    {isMine ? <Badge tone="info">Browser ini</Badge> : null}
                    {inactive ? <Badge tone="off">Tidak aktif</Badge> : null}
                  </b>
                  <small className="text-[13px] text-muted">
                    Aktif sejak {formatDateTime(s.created_at)} ·{' '}
                    {s.last_delivered_at
                      ? `notifikasi terakhir ${formatDateTime(s.last_delivered_at)}`
                      : 'belum ada notifikasi'}
                  </small>
                </div>
                <Button
                  variant="danger"
                  small
                  aria-label={`Cabut ${s.label}`}
                  onClick={() => setTarget(s)}
                >
                  Cabut
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {target ? (
        <ConfirmDialog
          title="Cabut perangkat ini?"
          confirmLabel="Cabut"
          pending={revoke.isPending}
          error={revoke.error ? errorMessage(revoke.error) : undefined}
          onConfirm={() => revoke.mutate(target)}
          onClose={() => {
            revoke.reset();
            setTarget(null);
          }}
        >
          {target.label} tidak akan menerima notifikasi lagi. Anda bisa mendaftarkannya lagi kapan
          saja.
        </ConfirmDialog>
      ) : null}
    </Card>
  );
}

const PREF_ROWS: { key: keyof NotificationPrefs; title: string; hint: string }[] = [
  {
    key: 'transaction',
    title: 'Transaksi masuk',
    hint: 'Setiap transaksi lunas, termasuk ringkasan dari mode offline.',
  },
  {
    key: 'void',
    title: 'Pembatalan transaksi',
    hint: 'Saat kasir mengajukan pembatalan dan saat pembatalan disetujui.',
  },
];

function PrefsCard({ locked, onToast }: { locked: boolean; onToast: (message: string) => void }) {
  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: PUSH_KEYS.prefs,
    queryFn: () => api<NotificationPrefs>('/notifications/prefs'),
  });
  const save = useMutation({
    mutationFn: (change: Partial<NotificationPrefs>) =>
      patch<NotificationPrefs>('/notifications/prefs', change),
    onMutate: async (change) => {
      await qc.cancelQueries({ queryKey: PUSH_KEYS.prefs });
      const previous = qc.getQueryData<NotificationPrefs>(PUSH_KEYS.prefs);
      if (previous) qc.setQueryData(PUSH_KEYS.prefs, { ...previous, ...change });
      return { previous };
    },
    onError: (_e, _c, ctx) => {
      if (ctx?.previous) qc.setQueryData(PUSH_KEYS.prefs, ctx.previous);
      onToast('Gagal menyimpan. Coba lagi.');
    },
    onSuccess: (saved) => {
      qc.setQueryData(PUSH_KEYS.prefs, saved);
      onToast('Tersimpan');
    },
  });
  const ids = [useId(), useId()];
  const hintId = useId();
  return (
    <Card>
      <h2 className="text-lg">Jenis notifikasi</h2>
      <p id={hintId} className="mb-1 text-sm text-muted">
        {locked
          ? 'Aktifkan notifikasi di minimal satu browser dulu untuk mengubah pilihan ini.'
          : 'Berlaku untuk semua browser yang terdaftar di akun Anda.'}
      </p>
      {prefs.isPending ? <Skeleton rows={2} /> : null}
      {prefs.error ? (
        <ErrorState onRetry={() => void prefs.refetch()}>{errorMessage(prefs.error)}</ErrorState>
      ) : null}
      {prefs.data
        ? PREF_ROWS.map((row, i) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-3 border-t border-line py-2 first:border-t-0"
            >
              <div className="min-w-0">
                <b id={ids[i]} className="block">
                  {row.title}
                </b>
                <small className="text-[13px] text-muted">{row.hint}</small>
              </div>
              <Switch
                checked={prefs.data[row.key]}
                labelledBy={ids[i] ?? ''}
                describedBy={hintId}
                disabled={locked}
                onChange={(next) => save.mutate({ [row.key]: next })}
              />
            </div>
          ))
        : null}
    </Card>
  );
}

export function NotificationsPage() {
  const [permission, refreshPermission] = usePermission();
  const [localSubscribed, setLocalSubscribed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const config = useQuery({
    queryKey: PUSH_KEYS.config,
    queryFn: () => api<PushConfig>('/notifications/push/config'),
  });
  const subscriptions = useQuery({
    queryKey: PUSH_KEYS.subscriptions,
    queryFn: () =>
      api<{ items: ServerSubscription[] }>('/notifications/push/subscriptions').then(
        (r) => r.items,
      ),
  });

  const refreshLocal = useCallback(() => {
    if (!pushSupported()) return;
    currentSubscription()
      .then((s) => setLocalSubscribed(s !== null))
      .catch(() => setLocalSubscribed(false));
  }, []);
  useEffect(refreshLocal, [refreshLocal, permission]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const error = config.error ?? subscriptions.error;
  const retry = () => {
    void config.refetch();
    void subscriptions.refetch();
  };
  const activeCount = (subscriptions.data ?? []).filter((s) => s.status === 'active').length;

  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader title="Notifikasi" subtitle="Pop-up transaksi di laptop owner" />
      {config.isPending || subscriptions.isPending ? <Skeleton /> : null}
      {error ? (
        <ErrorState onRetry={retry}>
          {error instanceof ApiError && error.status === 403
            ? 'Hanya pemilik yang dapat mengatur notifikasi.'
            : errorMessage(error)}
        </ErrorState>
      ) : null}
      {config.data && subscriptions.data ? (
        <div className="space-y-3">
          <BrowserCard
            config={config.data}
            subscriptions={subscriptions.data}
            permission={permission}
            refreshPermission={refreshPermission}
            localSubscribed={localSubscribed}
            onLocalChange={refreshLocal}
            onToast={setToast}
          />
          <DevicesCard
            subscriptions={subscriptions.data}
            permission={permission}
            localSubscribed={localSubscribed}
            onLocalChange={refreshLocal}
            onToast={setToast}
          />
          <PrefsCard locked={activeCount === 0} onToast={setToast} />
        </div>
      ) : null}
      {toast ? <Toast>{toast}</Toast> : null}
    </div>
  );
}
