import { describe, expect, it, vi } from 'vitest';
import { createErrorReporter, parseDsn } from './error-reporter.js';

const DSN = 'https://publickey@o123.ingest.sentry.io/4567';

describe('error reporter (Sentry envelope)', () => {
  it('derives the envelope endpoint from the DSN', () => {
    expect(parseDsn(DSN)).toMatchObject({
      key: 'publickey',
      envelopeUrl: 'https://o123.ingest.sentry.io/api/4567/envelope/',
    });
    expect(() => parseDsn('https://o123.ingest.sentry.io/4567')).toThrow(/DSN/);
  });

  it('posts the error with route context but no request data', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
    const report = createErrorReporter(
      { dsn: DSN, environment: 'staging', release: 'abc123' },
      fetchImpl,
    );
    await report(new TypeError('boom'), { method: 'GET', route: '/v1/x/:id', requestId: 'r1' });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://o123.ingest.sentry.io/api/4567/envelope/');
    expect(new Headers(init?.headers).get('x-sentry-auth')).toContain('sentry_key=publickey');
    const [header, item, event] = String(init?.body)
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(header).toMatchObject({ dsn: DSN });
    expect(item).toEqual({ type: 'event' });
    expect(event).toMatchObject({
      environment: 'staging',
      release: 'abc123',
      transaction: 'GET /v1/x/:id',
      exception: { values: [{ type: 'TypeError', value: 'boom' }] },
      extra: { request_id: 'r1' },
    });
    expect(event).not.toHaveProperty('request');
  });

  it('never throws when Sentry is unreachable', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    await expect(
      createErrorReporter({ dsn: DSN, environment: 'production' }, fetchImpl)('x'),
    ).resolves.toBeUndefined();
  });
});
