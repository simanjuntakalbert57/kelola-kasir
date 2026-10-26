import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip.js';

const secret = 's'.repeat(32);
const request = (headers: Record<string, string>): FastifyRequest =>
  ({ ip: '10.0.0.1', headers }) as unknown as FastifyRequest;

describe('clientIp', () => {
  it('trusts X-Client-IP only with the proxy secret', () => {
    const headers = { 'x-proxy-secret': secret, 'x-client-ip': '203.0.113.7' };
    expect(clientIp({ proxySharedSecret: secret }, request(headers))).toBe('203.0.113.7');
    expect(clientIp({ proxySharedSecret: null }, request(headers))).toBe('10.0.0.1');
  });

  it('ignores a wrong secret or a malformed address', () => {
    const config = { proxySharedSecret: secret };
    expect(
      clientIp(config, request({ 'x-proxy-secret': 'nope', 'x-client-ip': '203.0.113.7' })),
    ).toBe('10.0.0.1');
    expect(
      clientIp(config, request({ 'x-proxy-secret': secret, 'x-client-ip': 'not-an-ip' })),
    ).toBe('10.0.0.1');
    expect(clientIp(config, request({ 'x-client-ip': '203.0.113.7' }))).toBe('10.0.0.1');
  });
});
