import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import {
  currentSubscription,
  getStoredSubscriptionId,
  isSafePath,
  pushSupported,
  registerOnServer,
  registerServiceWorker,
  setStoredSubscriptionId,
} from '../lib/push';

/**
 * Renders nothing. While the owner is signed in it (1) follows `navigate` messages from the service worker
 * (notification click on an open tab) and (2) re-registers this browser's subscription when permission is
 * already granted, which refreshes `last_seen_at` and heals a lost/expired server record (ADR-0017 §8).
 */
export function PushBridge() {
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (!pushSupported()) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (data?.type === 'navigate' && isSafePath(data.url)) router.history.push(data.url);
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
        const before = getStoredSubscriptionId();
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
