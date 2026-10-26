import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { safeEqual } from './crypto.js';

/**
 * IP address of the end user, used for rate limits and audit logs.
 *
 * Dashboard calls arrive through the Cloudflare Pages Function proxy (ADR-0011), so the address the
 * API sees is a Cloudflare egress IP shared by every visitor. The proxy names the real client in
 * `X-Client-IP` and proves itself with `X-Proxy-Secret`; without a matching secret the header is
 * ignored, so direct callers (the cashier app) cannot spoof it.
 */
export function clientIp(config: Pick<Config, 'proxySharedSecret'>, req: FastifyRequest): string {
  const secret = config.proxySharedSecret;
  const presented = req.headers['x-proxy-secret'];
  const forwarded = req.headers['x-client-ip'];
  if (
    secret &&
    typeof presented === 'string' &&
    typeof forwarded === 'string' &&
    safeEqual(presented, secret) &&
    isIP(forwarded.trim()) !== 0
  ) {
    return forwarded.trim();
  }
  return req.ip;
}
