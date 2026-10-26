import type {
  Problem,
  ResponseBody,
  SyncMutation,
  TransactionCreate,
} from '@kelola-kasir/contracts';

/** Render Free cold start can take over a minute (TDD R-9); a shorter timeout reads as "offline". */
export const API_TIMEOUT_MS = 90_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly problem?: Problem,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Network failure (offline, DNS, timeout) as opposed to an HTTP error from the API. */
export class NetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface ShiftCloseBody {
  actual_cash: number;
  closed_at: string;
  closing_note?: string;
  closed_offline?: boolean;
  unsynced_count?: number;
}

export interface ApiClientOptions {
  baseUrl: string;
  getDeviceToken: () => string | null;
  getAccessToken: () => string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | undefined>;
  /** Send `X-Device-Token` (deviceAuth). */
  device?: boolean;
  /** Send employee bearer token (employeeAuth). */
  employee?: boolean;
}

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? API_TIMEOUT_MS;

  async function request(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<Response> {
    const url = new URL(options.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
    const headers: Record<string, string> = {
      Accept: 'application/json, application/problem+json',
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.device) {
      const token = options.getDeviceToken();
      if (token) headers['X-Device-Token'] = token;
    }
    if (opts.employee) {
      const token = options.getAccessToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url.toString(), {
        method,
        headers,
        body: opts.body === undefined ? null : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch {
      throw new NetworkError();
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw await toApiError(res);
    return res;
  }

  async function json<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
    const res = await request(method, path, opts);
    return (await res.json()) as T;
  }

  return {
    pairDevice: (pairingCode: string, appVersion: string) =>
      json<ResponseBody<'/devices/pair', 'post'>>('POST', '/devices/pair', {
        body: { pairing_code: pairingCode, app_version: appVersion, platform: 'android' },
      }),
    listDeviceEmployees: () =>
      json<ResponseBody<'/devices/me/employees', 'get'>>('GET', '/devices/me/employees', {
        device: true,
      }),
    pinLogin: (employeeId: string, pin: string) =>
      json<ResponseBody<'/auth/pin-login', 'post'>>('POST', '/auth/pin-login', {
        device: true,
        body: { employee_id: employeeId, pin },
      }),
    pinLogout: async () => {
      await request('POST', '/auth/pin-logout', { device: true, employee: true });
    },
    syncPull: (cursor?: string) =>
      json<ResponseBody<'/sync/pull', 'get'>>('GET', '/sync/pull', {
        device: true,
        query: { cursor },
      }),
    syncPush: (mutations: SyncMutation[]) =>
      json<ResponseBody<'/sync/push', 'post'>>('POST', '/sync/push', {
        device: true,
        body: { mutations },
      }),
    createTransaction: (body: TransactionCreate) =>
      json<ResponseBody<'/transactions', 'post', 201>>('POST', '/transactions', {
        device: true,
        employee: true,
        body,
      }),
    getPayment: (paymentId: string) =>
      json<ResponseBody<'/payments/{payment_id}', 'get'>>('GET', `/payments/${paymentId}`, {
        device: true,
        employee: true,
      }),
    confirmPayment: (paymentId: string) =>
      json<ResponseBody<'/payments/{payment_id}/confirm', 'post'>>(
        'POST',
        `/payments/${paymentId}/confirm`,
        { device: true, employee: true },
      ),
    cancelPayment: (paymentId: string) =>
      json<ResponseBody<'/payments/{payment_id}/cancel', 'post'>>(
        'POST',
        `/payments/${paymentId}/cancel`,
        { device: true, employee: true },
      ),
    /** `null` when the outlet has no open shift (204). */
    async getCurrentShift(): Promise<ResponseBody<'/shifts/current', 'get'> | null> {
      const res = await request('GET', '/shifts/current', { device: true, employee: true });
      if (res.status === 204) return null;
      return (await res.json()) as ResponseBody<'/shifts/current', 'get'>;
    },
    getShiftSummary: (shiftId: string) =>
      json<ResponseBody<'/shifts/{shift_id}/summary', 'get'>>('GET', `/shifts/${shiftId}/summary`, {
        device: true,
        employee: true,
      }),
    closeShift: (shiftId: string, body: ShiftCloseBody) =>
      json<ResponseBody<'/shifts/{shift_id}/close', 'post'>>('POST', `/shifts/${shiftId}/close`, {
        device: true,
        employee: true,
        body,
      }),
    listTransactions: (scope: 'shift' | 'today', limit = 100) =>
      json<ResponseBody<'/transactions', 'get'>>('GET', '/transactions', {
        device: true,
        employee: true,
        query: { scope, limit: String(limit) },
      }),
    getReceipt: (transactionId: string) =>
      json<ResponseBody<'/transactions/{transaction_id}/receipt', 'get'>>(
        'GET',
        `/transactions/${transactionId}/receipt`,
        { device: true, employee: true },
      ),
    createVoidRequest: (transactionId: string, body: { id: string; reason: string }) =>
      json<ResponseBody<'/transactions/{transaction_id}/void-requests', 'post', 201>>(
        'POST',
        `/transactions/${transactionId}/void-requests`,
        { device: true, employee: true, body },
      ),
    openShift: (input: { id: string; opening_cash: number; opened_at: string }) =>
      json<ResponseBody<'/shifts', 'post', 201>>('POST', '/shifts', {
        device: true,
        employee: true,
        body: input,
      }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const problem = (await res.json()) as Problem;
    return new ApiError(res.status, problem.code, problem.detail ?? problem.title, problem);
  } catch {
    return new ApiError(res.status, 'HTTP_ERROR', `HTTP ${res.status}`);
  }
}
