import webpush from 'web-push';
import type { WebPushConfig } from '../../config.js';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushOptions {
  ttlSeconds: number;
  urgency: 'high' | 'normal';
}

export type PushResult =
  | { ok: true; status: number }
  | { ok: false; status?: number; retryAfterSec?: number; error: string };

/** Thin seam over `web-push` so tests inject a fake. Results never contain the endpoint or the VAPID JWT. */
export interface PushClient {
  send(target: PushTarget, payload: string, options: PushOptions): Promise<PushResult>;
}

export const PUSH_TIMEOUT_MS = 5000;
const MAX_ERROR_LENGTH = 300;

/** Strip anything that could identify the browser (endpoint URL, its host) or carry credentials. */
export function sanitizeError(text: string, endpoint: string): string {
  let out = text;
  try {
    const url = new URL(endpoint);
    out = out.split(endpoint).join('[endpoint]').split(url.host).join('[push-host]');
  } catch {
    // not a URL: nothing more to strip
  }
  out = out
    .replace(/(vapid|bearer)\s+\S+/gi, '$1 [redacted]')
    .replace(/\bt=[\w.-]+/g, 't=[redacted]');
  return out.slice(0, MAX_ERROR_LENGTH);
}

export function createWebPushClient(config: WebPushConfig): PushClient {
  const vapidDetails = {
    subject: config.subject,
    publicKey: config.publicKey,
    privateKey: config.privateKey,
  };
  return {
    async send(target, payload, options) {
      try {
        const res = await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload,
          {
            TTL: options.ttlSeconds,
            urgency: options.urgency,
            timeout: PUSH_TIMEOUT_MS,
            vapidDetails,
          },
        );
        return { ok: true, status: res.statusCode };
      } catch (err) {
        const e = err as {
          name?: string;
          code?: string;
          statusCode?: number;
          body?: unknown;
          headers?: Record<string, string | string[] | undefined>;
        };
        if (typeof e.statusCode === 'number') {
          const retryRaw = e.headers?.['retry-after'];
          const retry = Number(Array.isArray(retryRaw) ? retryRaw[0] : retryRaw);
          const body =
            typeof e.body === 'string' ? ` ${sanitizeError(e.body, target.endpoint)}` : '';
          return {
            ok: false,
            status: e.statusCode,
            ...(Number.isFinite(retry) && retry > 0 ? { retryAfterSec: retry } : {}),
            error: `HTTP ${e.statusCode}${body}`.slice(0, MAX_ERROR_LENGTH),
          };
        }
        // Network error or timeout: name and code only, the message may contain addresses.
        return { ok: false, error: `${e.name ?? 'Error'}${e.code ? ` ${e.code}` : ''}` };
      }
    },
  };
}
