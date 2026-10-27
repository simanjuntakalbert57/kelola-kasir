/**
 * Same-origin proxy `/v1/*` → API, run as a Cloudflare Pages Function (ADR-0011).
 *
 * The dashboard (`*.pages.dev`) and the API (own domain on the VPS, ADR-0012) are different sites, so the refresh
 * cookie only works when the browser talks to its own origin. This handler lives in `src/` so it is
 * linted, typechecked and tested with the dashboard; it is never imported by the SPA bundle.
 */

export interface ProxyEnv {
  /** e.g. https://api.example.com (no trailing path). */
  API_ORIGIN?: string;
  /** Same value as the API's PROXY_SHARED_SECRET; lets the API trust `X-Client-IP`. */
  PROXY_SHARED_SECRET?: string;
}

/**
 * Request headers the API needs. Everything else (other cookies, CF-* headers) stays behind.
 * `x-device-token` carries the kasir app's device auth (ADR-0014: the APK reaches the API through this proxy).
 */
const FORWARDED_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'cookie',
  'idempotency-key',
  'if-none-match',
  'user-agent',
  'x-device-token',
];

const problem = (status: number, code: string, title: string): Response =>
  new Response(JSON.stringify({ type: 'about:blank', status, code, title }), {
    status,
    headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' },
  });

export async function proxyRequest(
  request: Request,
  env: ProxyEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!env.API_ORIGIN) return problem(500, 'PROXY_NOT_CONFIGURED', 'API_ORIGIN is not set');

  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, env.API_ORIGIN);

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Overwrite (never append) so a client cannot inject its own forwarding chain.
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) {
    headers.set('x-forwarded-for', clientIp);
    if (env.PROXY_SHARED_SECRET) {
      headers.set('x-client-ip', clientIp);
      headers.set('x-proxy-secret', env.PROXY_SHARED_SECRET);
    }
  }
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));

  const method = request.method.toUpperCase();
  // API bodies are small JSON (photos go straight to R2 via presigned URLs), so buffering is fine.
  const body = method === 'GET' || method === 'HEAD' ? null : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetchImpl(target.toString(), { method, headers, body, redirect: 'manual' });
  } catch {
    return problem(502, 'UPSTREAM_UNAVAILABLE', 'The API could not be reached');
  }
  // Re-wrap so the headers are mutable for the platform; Set-Cookie stays host-only (no Domain).
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: new Headers(upstream.headers),
  });
}
