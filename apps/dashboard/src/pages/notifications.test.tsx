import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, mockApi, problem, renderApp, session } from '../test/helpers';

const SUB_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';
const PUBLIC_VALUE = 'dGVzdA';

const mine = {
  id: SUB_ID,
  label: 'Chrome di Windows',
  status: 'active',
  created_at: '2026-10-30T03:00:00Z',
  last_delivered_at: null,
};
const other = {
  ...mine,
  id: OTHER_ID,
  label: 'Edge di macOS',
  last_delivered_at: '2026-10-30T05:00:00Z',
};
const prefs = { transaction: true, void: true };
const configOn = { configured: true, vapid_public_key: PUBLIC_VALUE };

const base = {
  'POST /auth/refresh': () => json(session),
  'GET /notifications/push/config': () => json(configOn),
  'GET /notifications/prefs': () => json(prefs),
};

interface Env {
  permission: NotificationPermission;
  subscription: { toJSON: () => unknown; unsubscribe: ReturnType<typeof vi.fn> } | null;
  request: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  showNotification: ReturnType<typeof vi.fn>;
}

/** jsdom has no Service Worker / Push / Notification APIs; install minimal fakes. */
function installBrowser(
  init: Partial<Pick<Env, 'permission' | 'subscription'>> = {},
  answer: NotificationPermission = 'granted',
): Env {
  const env: Env = {
    permission: init.permission ?? 'default',
    subscription: init.subscription ?? null,
    request: vi.fn(),
    subscribe: vi.fn(),
    showNotification: vi.fn(async () => undefined),
  };
  const makeSub = () => ({
    toJSON: () => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p', auth: 'a' },
    }),
    unsubscribe: vi.fn(async () => true),
  });
  env.request.mockImplementation(async () => {
    env.permission = answer;
    return answer;
  });
  env.subscribe.mockImplementation(async () => {
    env.subscription = makeSub();
    return env.subscription;
  });
  const registration = {
    pushManager: { getSubscription: async () => env.subscription, subscribe: env.subscribe },
    showNotification: env.showNotification,
  };
  const FakeNotification = Object.assign(function Notification() {}, {
    requestPermission: env.request,
  });
  Object.defineProperty(FakeNotification, 'permission', { get: () => env.permission });
  const FakePushManager = function PushManager() {};
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('PushManager', FakePushManager);
  Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true });
  Object.defineProperty(window, 'PushManager', { value: FakePushManager, configurable: true });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
      getRegistration: vi.fn(async () => registration),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: vi.fn(async () => ({ onchange: null })) },
  });
  return env;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'Notification');
  Reflect.deleteProperty(window, 'PushManager');
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

const activeSub = () => ({ toJSON: () => ({}), unsubscribe: vi.fn(async () => true) });

describe('Pengaturan → Notifikasi', () => {
  it('shows the unsupported state without any action button', async () => {
    mockApi({ ...base, 'GET /notifications/push/subscriptions': () => json({ items: [] }) });
    renderApp('/pengaturan/notifikasi');
    expect(await screen.findByText('Tidak didukung')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aktifkan notifikasi/ })).not.toBeInTheDocument();
    expect(screen.getByText('Belum ada browser yang terdaftar.')).toBeInTheDocument();
  });

  it('shows "Belum tersedia" when the server has no VAPID keys', async () => {
    installBrowser();
    mockApi({
      ...base,
      'GET /notifications/push/config': () => json({ configured: false, vapid_public_key: null }),
      'GET /notifications/push/subscriptions': () => json({ items: [] }),
    });
    renderApp('/pengaturan/notifikasi');
    expect(await screen.findByText('Belum tersedia')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aktifkan/ })).not.toBeInTheDocument();
  });

  it('does not ask for permission on load; enabling subscribes and registers the browser', async () => {
    const env = installBrowser();
    let created = false;
    const calls = mockApi({
      ...base,
      'GET /notifications/push/subscriptions': () => json({ items: created ? [mine] : [] }),
      'POST /notifications/push/subscriptions': () => {
        created = true;
        return json(mine, 201);
      },
    });
    renderApp('/pengaturan/notifikasi');
    const enable = await screen.findByRole('button', {
      name: 'Aktifkan notifikasi di browser ini',
    });
    expect(env.request).not.toHaveBeenCalled();
    await userEvent.click(enable);
    expect(await screen.findByText('Aktif di browser ini')).toBeInTheDocument();
    expect(env.request).toHaveBeenCalledOnce();
    const post = calls.find((c) => c.key === 'POST /notifications/push/subscriptions');
    expect(post?.body).toMatchObject({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p', auth: 'a' },
      label: expect.stringMatching(/\S/),
    });
    expect(env.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      }),
    );
    expect(localStorage.getItem('kelola-kasir.push-subscription-id')).toBe(SUB_ID);
    expect(env.showNotification).toHaveBeenCalledWith('✅ Notifikasi aktif', expect.any(Object));
    expect(await screen.findByText('Notifikasi diaktifkan')).toBeInTheDocument();
  });

  it('returns to the default state when the permission prompt is dismissed', async () => {
    installBrowser({}, 'default');
    mockApi({ ...base, 'GET /notifications/push/subscriptions': () => json({ items: [] }) });
    renderApp('/pengaturan/notifikasi');
    await userEvent.click(await screen.findByRole('button', { name: /Aktifkan notifikasi/ }));
    expect(await screen.findByText('Belum aktif')).toBeInTheDocument();
  });

  it('shows the blocked guide when permission is denied', async () => {
    installBrowser({ permission: 'denied' });
    mockApi({ ...base, 'GET /notifications/push/subscriptions': () => json({ items: [] }) });
    renderApp('/pengaturan/notifikasi');
    expect(await screen.findByText('Diblokir')).toBeInTheDocument();
    expect(screen.getByText(/Ubah/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Muat ulang halaman' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aktifkan/ })).not.toBeInTheDocument();
  });

  it('offers re-registration when granted but the server forgot this browser', async () => {
    installBrowser({ permission: 'granted', subscription: activeSub() });
    localStorage.setItem('kelola-kasir.push-subscription-id', 'gone-id');
    mockApi({
      ...base,
      'GET /notifications/push/subscriptions': () => json({ items: [] }),
      'POST /notifications/push/subscriptions': () => json(mine, 201),
    });
    renderApp('/pengaturan/notifikasi');
    expect(
      await screen.findByRole('button', { name: 'Daftarkan ulang browser ini' }),
    ).toBeInTheDocument();
  });

  describe('when active', () => {
    const setup = (routes: Record<string, (b: unknown) => Response> = {}) => {
      const env = installBrowser({ permission: 'granted', subscription: activeSub() });
      localStorage.setItem('kelola-kasir.push-subscription-id', SUB_ID);
      const calls = mockApi({
        ...base,
        'GET /notifications/push/subscriptions': () => json({ items: [mine, other] }),
        'POST /notifications/push/subscriptions': () => json(mine),
        ...routes,
      });
      renderApp('/pengaturan/notifikasi');
      return { env, calls };
    };

    it('lists devices, marks this browser, and sends a test notification', async () => {
      const { calls } = setup({
        [`POST /notifications/push/subscriptions/${SUB_ID}/test`]: () => json({ result: 'sent' }),
      });
      expect(await screen.findByText('Aktif di browser ini')).toBeInTheDocument();
      expect(screen.getByText('Chrome di Windows')).toBeInTheDocument();
      expect(screen.getByText('Edge di macOS')).toBeInTheDocument();
      expect(screen.getByText('Browser ini')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Kirim notifikasi uji' }));
      expect(await screen.findByText(/Notifikasi uji terkirim/)).toBeInTheDocument();
      expect(
        calls.some((c) => c.key === `POST /notifications/push/subscriptions/${SUB_ID}/test`),
      ).toBe(true);
    });

    it('410 on test flips the card to re-register', async () => {
      let expired = false;
      setup({
        'GET /notifications/push/subscriptions': () =>
          json({ items: [{ ...mine, status: expired ? 'expired' : 'active' }] }),
        [`POST /notifications/push/subscriptions/${SUB_ID}/test`]: () => {
          expired = true;
          return problem(410, 'NOTIFICATION_SUBSCRIPTION_GONE');
        },
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Kirim notifikasi uji' }));
      expect(
        await screen.findByRole('button', { name: 'Daftarkan ulang browser ini' }),
      ).toBeInTheDocument();
    });

    it('shows the rate-limit and delivery-failure messages', async () => {
      let status = 429;
      setup({
        [`POST /notifications/push/subscriptions/${SUB_ID}/test`]: () =>
          status === 429 ? problem(429, 'RATE_LIMITED') : problem(502, 'PUSH_DELIVERY_FAILED'),
      });
      const button = await screen.findByRole('button', { name: 'Kirim notifikasi uji' });
      await userEvent.click(button);
      expect(await screen.findByText(/Tunggu beberapa detik/)).toBeInTheDocument();
      status = 502;
      await userEvent.click(screen.getByRole('button', { name: 'Kirim notifikasi uji' }));
      expect(await screen.findByText(/Notifikasi uji gagal/)).toBeInTheDocument();
    });

    it('revokes this browser after confirmation and unsubscribes locally', async () => {
      let revoked = false;
      const { env } = setup({
        'GET /notifications/push/subscriptions': () =>
          json({ items: revoked ? [other] : [mine, other] }),
        [`DELETE /notifications/push/subscriptions/${SUB_ID}`]: () => {
          revoked = true;
          return new Response(null, { status: 204 });
        },
      });
      const sub = env.subscription;
      await userEvent.click(await screen.findByRole('button', { name: 'Cabut Chrome di Windows' }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cabut' }));
      expect(await screen.findByText('Perangkat dicabut')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText('Chrome di Windows')).not.toBeInTheDocument());
      expect(sub?.unsubscribe).toHaveBeenCalled();
      expect(localStorage.getItem('kelola-kasir.push-subscription-id')).toBeNull();
    });

    it('toggles a preference optimistically and rolls back on failure', async () => {
      let fail = false;
      setup({
        'PATCH /notifications/prefs': (b) =>
          fail ? problem(500, 'INTERNAL_ERROR') : json({ ...prefs, ...(b as object) }),
      });
      const toggle = await screen.findByRole('switch', { name: 'Transaksi masuk' });
      expect(toggle).toBeChecked();
      await userEvent.click(toggle);
      expect(await screen.findByText('Tersimpan')).toBeInTheDocument();
      expect(toggle).not.toBeChecked();
      fail = true;
      await userEvent.click(toggle);
      expect(await screen.findByText('Gagal menyimpan. Coba lagi.')).toBeInTheDocument();
      expect(toggle).not.toBeChecked();
    });
  });

  it('does not re-create a revoked browser on startup (no POST when the stored id is not listed)', async () => {
    installBrowser({ permission: 'granted', subscription: activeSub() });
    localStorage.setItem('kelola-kasir.push-subscription-id', 'revoked-id');
    const calls = mockApi({
      ...base,
      'GET /notifications/push/subscriptions': () => json({ items: [other] }),
      'POST /notifications/push/subscriptions': () => json(mine, 201),
    });
    renderApp('/pengaturan/notifikasi');
    await screen.findByRole('button', { name: 'Daftarkan ulang browser ini' });
    expect(calls.some((c) => c.key === 'POST /notifications/push/subscriptions')).toBe(false);
  });

  it('does not re-create a browser that is listed but expired', async () => {
    installBrowser({ permission: 'granted', subscription: activeSub() });
    localStorage.setItem('kelola-kasir.push-subscription-id', SUB_ID);
    const calls = mockApi({
      ...base,
      'GET /notifications/push/subscriptions': () =>
        json({ items: [{ ...mine, status: 'expired' }] }),
      'POST /notifications/push/subscriptions': () => json(mine, 201),
    });
    renderApp('/pengaturan/notifikasi');
    await screen.findByRole('button', { name: 'Daftarkan ulang browser ini' });
    expect(calls.some((c) => c.key === 'POST /notifications/push/subscriptions')).toBe(false);
  });

  it('locks the toggles until a browser is active', async () => {
    installBrowser();
    mockApi({ ...base, 'GET /notifications/push/subscriptions': () => json({ items: [] }) });
    renderApp('/pengaturan/notifikasi');
    const toggle = await screen.findByRole('switch', { name: 'Transaksi masuk' });
    expect(toggle).toBeDisabled();
  });
});
