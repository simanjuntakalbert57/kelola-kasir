import type { Problem, components } from '@kelola-kasir/contracts';

export type OwnerSession = components['schemas']['OwnerSession'];

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// Access token lives in memory only (ADR-0004); the refresh token is an HttpOnly cookie.
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;
let refreshing: Promise<OwnerSession | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Called when the session cannot be recovered (refresh failed). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function toError(res: Response): Promise<ApiError> {
  const problem = (await res.json().catch(() => null)) as Partial<Problem> | null;
  return new ApiError(
    res.status,
    problem?.code ?? 'UNKNOWN',
    problem?.detail ?? problem?.title ?? `Permintaan gagal (${res.status})`,
  );
}

async function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${BASE_URL}${path}`, { ...init, headers, credentials: 'include' });
}

/** Rotate the refresh cookie; concurrent callers share one request. */
export function refreshSession(): Promise<OwnerSession | null> {
  refreshing ??= (async () => {
    try {
      const res = await send('/auth/refresh', { method: 'POST' }, null);
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const session = (await res.json()) as OwnerSession;
      accessToken = session.access_token;
      return session;
    } catch {
      accessToken = null;
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init, accessToken);
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const session = await refreshSession();
    if (!session) {
      onUnauthorized?.();
      throw new ApiError(401, 'UNAUTHORIZED', 'Sesi berakhir, silakan masuk lagi.');
    }
    res = await send(path, init, session.access_token);
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
