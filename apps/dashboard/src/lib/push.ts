import type { PushSubscription as ServerSubscription } from '@kelola-kasir/contracts';
import { post } from './api';

const STORAGE_KEY = 'kelola-kasir.push-subscription-id';
const SW_URL = '/sw.js';

export type PermissionState = NotificationPermission;

/** Service Worker, Push API and Notification API are all required (e.g. missing on iOS Safari outside a PWA). */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export const getStoredSubscriptionId = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export const setStoredSubscriptionId = (id: string | null): void => {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked; the "Browser ini" marker is then simply not shown.
  }
};

/** "Chrome di Windows", derived from the User-Agent (max 60 characters, as the API requires). */
export function deviceLabel(ua: string = navigator.userAgent): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux|X11/.test(ua)
            ? 'Linux'
            : null;
  return (os ? `${browser} di ${os}` : browser).slice(0, 60);
}

function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Registers `/sw.js` (scope `/`) and waits until it is active. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  return navigator.serviceWorker.ready;
}

/** The browser's current push subscription, if any. Never asks for permission. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  return registration ? registration.pushManager.getSubscription() : null;
}

/** Reuses an existing browser subscription; otherwise creates one (requires granted permission). */
export async function subscribeBrowser(vapidPublicKey: string): Promise<PushSubscription> {
  const registration = await registerServiceWorker();
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToBytes(vapidPublicKey),
  });
}

/** Upserts the subscription on the server and remembers its id as "this browser". */
export async function registerOnServer(sub: PushSubscription): Promise<ServerSubscription> {
  const json = sub.toJSON();
  const saved = await post<ServerSubscription>('/notifications/push/subscriptions', {
    endpoint: json.endpoint,
    keys: json.keys,
    label: deviceLabel(),
  });
  setStoredSubscriptionId(saved.id);
  return saved;
}

/** Local confirmation right after enabling (not a server push). */
export async function showEnabledNotification(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification('✅ Notifikasi aktif', {
    body: 'Anda akan menerima pop-up transaksi di browser ini.',
    icon: '/icons/notif-192.png',
    tag: 'enabled',
    data: { url: '/pengaturan/notifikasi' },
  });
}

/** Drops the browser-side subscription and the "this browser" marker. */
export async function unsubscribeBrowser(): Promise<void> {
  try {
    const sub = await currentSubscription();
    await sub?.unsubscribe();
  } finally {
    setStoredSubscriptionId(null);
  }
}

/** Same rule as the service worker: only same-origin paths are followed. */
export const isSafePath = (url: unknown): url is string =>
  typeof url === 'string' && url.startsWith('/') && !url.startsWith('//');
