import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import type { PushSubscription as ServerSubscription } from '@kelola-kasir/contracts';
import { useEffect } from 'react';
import { api } from '../lib/api';
import {
  currentSubscription,
  getStoredSubscriptionId,
  pushSupported,
  registerOnServer,
  registerServiceWorker,
  safePath,
  setStoredSubscriptionId,
} from '../lib/push';

/**
 * Renders nothing. While the owner is signed in it (1) follows `navigate` messages from the service worker
 * (notification click on an open tab) and (2) refreshes this browser's subscription (`last_seen_at`) only when the server still lists it as active;
 * a revoked browser is never re-registered without the owner's click (ADR-0017 §8).
 */
export function PushBridge() {
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (!pushSupported()) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      const path = data?.type === 'navigate' ? safePath(data.url) : null;
      if (path) router.history.push(path);
    };
    const container = navigator.serviceWorker;
    container.addEventListener('message', onMessage);
    return () => container.removeEventListener('message', onMessage);
  }, [router]);

  useEffect(() => {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    let cancelled = false;
    void (async () => {
      try {
        await registerServiceWorker();
        const sub = await currentSubscription();
        if (!sub) {
          setStoredSubscriptionId(null);
          return;
        }
        // Only heal a record that still exists and is active. A revoked/unknown id must not be re-created
        // silently: the settings page offers "Daftarkan ulang" and waits for the owner (ADR-0017 §8).
        const before = getStoredSubscriptionId();
        if (!before) return;
        const { items } = await api<{ items: ServerSubscription[] }>(
          '/notifications/push/subscriptions',
        );
        if (cancelled || !items.some((s) => s.id === before && s.status === 'active')) return;
        const saved = await registerOnServer(sub);
        if (!cancelled && saved.id !== before) {
          await qc.invalidateQueries({ queryKey: ['push-subscriptions'] });
        }
      } catch {
        // Reconciliation is best effort (offline, push not configured, non-owner); the settings page shows the real state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qc]);

  return null;
}
