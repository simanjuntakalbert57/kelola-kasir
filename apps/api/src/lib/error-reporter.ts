import { randomUUID } from 'node:crypto';

/**
 * Minimal Sentry client: posts one envelope per unexpected error (HTTP 5xx) to the project's ingest
 * endpoint. The official SDK pulls in OpenTelemetry, which noticeably slows cold starts on Render
 * Free (0.1 CPU, ADR-0011); we only need error reporting, not tracing.
 *
 * Only the error and the route are sent: never headers, cookies, bodies or query strings.
 */

export interface ErrorContext {
  method?: string;
  /** Route pattern (e.g. `/v1/products/:product_id`), not the concrete URL. */
  route?: string | undefined;
  requestId?: string;
}

export type ErrorReporter = (error: unknown, context?: ErrorContext) => Promise<void>;

interface ParsedDsn {
  key: string;
  envelopeUrl: string;
  dsn: string;
}

export function parseDsn(dsn: string): ParsedDsn {
  const url = new URL(dsn);
  const projectId = url.pathname.split('/').filter(Boolean).pop();
  if (!url.username || !projectId) throw new Error('Invalid Sentry DSN');
  const base = url.pathname.replace(/\/[^/]*\/?$/, '');
  return {
    key: url.username,
    envelopeUrl: `${url.protocol}//${url.host}${base}/api/${projectId}/envelope/`,
    dsn,
  };
}

export function buildEnvelope(
  dsn: ParsedDsn,
  error: unknown,
  context: ErrorContext,
  meta: { environment: string; release?: string; now: Date },
): string {
  const err = error instanceof Error ? error : new Error(String(error));
  const eventId = randomUUID().replaceAll('-', '');
  const event = {
    event_id: eventId,
    timestamp: meta.now.getTime() / 1000,
    platform: 'node',
    level: 'error',
    logger: 'kelola-kasir-api',
    environment: meta.environment,
    ...(meta.release ? { release: meta.release } : {}),
    ...(context.route ? { transaction: `${context.method ?? ''} ${context.route}`.trim() } : {}),
    exception: { values: [{ type: err.name, value: err.message }] },
    tags: {
      ...(context.method ? { method: context.method } : {}),
      ...(context.route ? { route: context.route } : {}),
    },
    extra: {
      ...(context.requestId ? { request_id: context.requestId } : {}),
      ...(err.stack ? { stack: err.stack } : {}),
    },
  };
  return [
    JSON.stringify({ event_id: eventId, sent_at: meta.now.toISOString(), dsn: dsn.dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
}

export function createErrorReporter(
  options: { dsn: string; environment: string; release?: string },
  fetchImpl: typeof fetch = fetch,
): ErrorReporter {
  const dsn = parseDsn(options.dsn);
  return async (error, context = {}) => {
    const body = buildEnvelope(dsn, error, context, {
      environment: options.environment,
      ...(options.release ? { release: options.release } : {}),
      now: new Date(),
    });
    try {
      await fetchImpl(dsn.envelopeUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-sentry-envelope',
          'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=kelola-kasir-api/1.0`,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Reporting must never break or slow down request handling.
    }
  };
}
