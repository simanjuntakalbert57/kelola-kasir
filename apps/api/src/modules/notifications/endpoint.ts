/**
 * Anti-SSRF validation of push subscriptions (ADR-0017 §7). The API sends HTTP requests to the
 * `endpoint` a client supplies, so only well-known push services are accepted.
 * Adding a vendor means changing this constant and the ADR.
 */
export const PUSH_HOST_ALLOWLIST: readonly RegExp[] = [
  /^fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
];

export const MAX_ENDPOINT_LENGTH = 1024;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  // IP literals never match the name patterns below, but be explicit.
  if (/^[0-9.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
  return PUSH_HOST_ALLOWLIST.some((pattern) => pattern.test(host));
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Whether `value` is base64url and decodes to exactly `bytes` bytes. */
export function isBase64UrlOfLength(value: string, bytes: number): boolean {
  return BASE64URL.test(value) && Buffer.from(value, 'base64url').length === bytes;
}
