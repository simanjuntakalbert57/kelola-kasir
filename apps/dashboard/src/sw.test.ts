import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (event: Record<string, unknown>) => void;

/** Runs the real `public/sw.js` against a fake worker global and returns its registered handlers. */
function loadWorker() {
  const handlers: Record<string, Handler> = {};
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => null);
  const clients = { matchAll: vi.fn(), openWindow, claim: vi.fn(async () => undefined) };
  const self = {
    addEventListener: (type: string, h: Handler) => (handlers[type] = h),
    registration: { showNotification },
    clients,
    location: { origin: 'https://kelola.test' },
    skipWaiting: vi.fn(),
  };
  const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
  new Function('self', source)(self);
  return { handlers, showNotification, clients, openWindow };
}

const pushEvent = (payload: unknown) => {
  const waits: Promise<unknown>[] = [];
  return {
    event: {
      data: {
        json: () =>
          payload instanceof Error
            ? (() => {
                throw payload;
              })()
            : payload,
      },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    },
    waits,
  };
};

describe('service worker', () => {
  let sw: ReturnType<typeof loadWorker>;
  beforeEach(() => {
    sw = loadWorker();
  });

  it('registers only install/activate/push/notificationclick (no fetch handler)', () => {
    expect(Object.keys(sw.handlers).sort()).toEqual([
      'activate',
      'install',
      'notificationclick',
      'push',
    ]);
  });

  it('shows the payload with tag, icon and a safe click url', async () => {
    const { event, waits } = pushEvent({
      v: 1,
      title: '💰 Transaksi masuk Rp45.000',
      body: 'QRIS · 3 item',
      tag: 'trx-1',
      url: '/transaksi?date_from=2026-10-30&date_to=2026-10-30',
    });
    sw.handlers['push']?.(event);
    await Promise.all(waits);
    expect(sw.showNotification).toHaveBeenCalledWith(
      '💰 Transaksi masuk Rp45.000',
      expect.objectContaining({
        body: 'QRIS · 3 item',
        tag: 'trx-1',
        renotify: false,
        requireInteraction: false,
        icon: '/icons/notif-192.png',
        badge: '/icons/notif-badge-96.png',
        data: { url: '/transaksi?date_from=2026-10-30&date_to=2026-10-30' },
      }),
    );
  });

  it('falls back to a generic notification when the payload cannot be parsed', async () => {
    const { event, waits } = pushEvent(new Error('bad json'));
    sw.handlers['push']?.(event);
    await Promise.all(waits);
    expect(sw.showNotification).toHaveBeenCalledWith(
      'Kelola Kasir',
      expect.objectContaining({ body: 'Ada aktivitas baru', data: { url: '/' } }),
    );
  });

  it('replaces a foreign push url with the dashboard root', async () => {
    const { event, waits } = pushEvent({ title: 'x', body: 'y', url: '//evil.example/x' });
    sw.handlers['push']?.(event);
    await Promise.all(waits);
    expect(sw.showNotification).toHaveBeenCalledWith(
      'x',
      expect.objectContaining({ data: { url: '/' } }),
    );
  });

  const click = async (url: unknown) => {
    const waits: Promise<unknown>[] = [];
    const close = vi.fn();
    sw.handlers['notificationclick']?.({
      notification: { close, data: { url } },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
    return close;
  };

  it('focuses an open dashboard tab and tells it to navigate', async () => {
    const tab = {
      url: 'https://kelola.test/produk',
      postMessage: vi.fn(),
      focus: vi.fn(async () => tab),
    };
    sw.clients.matchAll.mockResolvedValue([{ url: 'https://other.test/', focus: vi.fn() }, tab]);
    const close = await click('/void');
    expect(close).toHaveBeenCalled();
    expect(tab.postMessage).toHaveBeenCalledWith({ type: 'navigate', url: '/void' });
    expect(tab.focus).toHaveBeenCalled();
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it('opens a new tab when no dashboard tab exists', async () => {
    sw.clients.matchAll.mockResolvedValue([]);
    await click('/transaksi');
    expect(sw.openWindow).toHaveBeenCalledWith('/transaksi');
  });

  it('never opens a foreign url from a click', async () => {
    sw.clients.matchAll.mockResolvedValue([]);
    await click('//evil.example');
    expect(sw.openWindow).toHaveBeenCalledWith('/');
  });
});
