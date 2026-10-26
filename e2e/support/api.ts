import { v7 as uuidv7 } from 'uuid';

export const API = 'http://127.0.0.1:3100/v1';
export const OWNER_EMAIL = 'owner@e2e.test';
export const OWNER_PASSWORD = process.env['E2E_OWNER_PASSWORD'] ?? 'e2e-owner-password-123';
export const LOCKOUT_EMAIL = 'lockout@e2e.test';
export const QRIS_OWNER_EMAIL = 'qris@e2e.test';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    super(`${what} -> ${status} ${body}`);
  }
}

export async function call<T = Record<string, any>>(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown; expect?: number | number[] } = {},
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...opts.headers },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  const expected = opts.expect === undefined ? [200, 201] : [opts.expect].flat();
  if (!expected.includes(res.status)) throw new ApiFailure(res.status, text, `${method} ${path}`);
  return { status: res.status, data: (text ? JSON.parse(text) : {}) as T };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export async function ownerToken(email = OWNER_EMAIL, password = OWNER_PASSWORD): Promise<string> {
  const { data } = await call<{ access_token: string }>('POST', '/auth/login', {
    body: { email, password },
  });
  return data.access_token;
}

const tlv = (tag: string, value: string) =>
  `${tag}${String(value.length).padStart(2, '0')}${value}`;
function crc16(input: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
/** Well-formed static QRIS payload with a valid CRC (test merchant). */
export function buildQris(merchant = 'JUS E2E'): string {
  const body =
    tlv('00', '01') +
    tlv('01', '11') +
    tlv('26', tlv('00', 'ID.CO.QRIS.WWW') + tlv('01', 'ID1023456789012') + tlv('02', '93600000')) +
    tlv('52', '5814') +
    tlv('53', '360') +
    tlv('58', 'ID') +
    tlv('59', merchant) +
    tlv('60', 'JAKARTA') +
    '6304';
  return body + crc16(body);
}

export interface Cashier {
  employeeId: string;
  name: string;
  pin: string;
  headers: Record<string, string>;
}

// Random start keeps numbers unique across processes (global setup vs. specs); format {OUTLET}-{DEV}-{YYMMDD}-{seq4}.
export const startNumbering = (n: number) => {
  seq = n;
};
let seq = 1000 + Math.floor(Math.random() * 4000);
let pin = 482_000;
export const nextPin = () => String(pin++);

export interface Shop {
  owner: string;
  deviceToken: string;
  deviceId: string;
  deviceCode: string;
  outletCode?: string;
  categoryId: string;
  products: { alpukat: Product; jeruk: Product };
}
export interface Product {
  id: string;
  name: string;
  price: number;
}

export async function createCashier(
  owner: string,
  deviceToken: string,
  name: string,
): Promise<Cashier> {
  const pinValue = nextPin();
  const { data: emp } = await call<{ id: string }>('POST', '/employees', {
    headers: bearer(owner),
    body: { name, pin: pinValue },
  });
  const { data: login } = await call<{ access_token: string }>('POST', '/auth/pin-login', {
    headers: { 'x-device-token': deviceToken },
    body: { employee_id: emp.id, pin: pinValue },
  });
  return {
    employeeId: emp.id,
    name,
    pin: pinValue,
    headers: { authorization: `Bearer ${login.access_token}`, 'x-device-token': deviceToken },
  };
}

export async function openShift(c: Cashier, openingCash: number, at = new Date()): Promise<string> {
  const { data } = await call<{ id: string }>('POST', '/shifts', {
    headers: c.headers,
    body: { id: uuidv7(), opening_cash: openingCash, opened_at: at.toISOString() },
  });
  return data.id;
}

export async function closeShift(c: Cashier, shiftId: string, actualCash: number) {
  return call<Record<string, any>>('POST', `/shifts/${shiftId}/close`, {
    headers: c.headers,
    body: { actual_cash: actualCash, closed_at: new Date().toISOString() },
  });
}

export interface Sale {
  id: string;
  number: string;
  paymentId: string;
  total: number;
}

export async function sell(
  shop: Shop,
  c: Cashier,
  shiftId: string,
  product: Product,
  qty: number,
  method: 'cash' | 'qris',
  opts: { tendered?: number; buyer?: string } = {},
): Promise<Sale> {
  const total = product.price * qty;
  const id = uuidv7();
  const paymentId = uuidv7();
  const number = `${shop.outletCode ?? 'JUS1'}-${shop.deviceCode}-261026-${String(seq++).padStart(4, '0')}`;
  await call('POST', '/transactions', {
    headers: c.headers,
    body: {
      id,
      shift_id: shiftId,
      number,
      client_created_at: new Date().toISOString(),
      ...(opts.buyer ? { customer_label: opts.buyer } : {}),
      items: [
        {
          id: uuidv7(),
          product_id: product.id,
          product_name: product.name,
          unit_price: product.price,
          quantity: qty,
          line_total: total,
        },
      ],
      subtotal: total,
      discount_amount: 0,
      tax_amount: 0,
      total,
      payment:
        method === 'cash'
          ? { id: paymentId, method: 'cash', cash_tendered: opts.tendered ?? total }
          : { id: paymentId, method: 'qris' },
    },
  });
  return { id, number, paymentId, total };
}

export const confirmQris = (c: Cashier, s: Sale) =>
  call('POST', `/payments/${s.paymentId}/confirm`, { headers: c.headers, body: {} });
export const cancelQris = (c: Cashier, s: Sale) =>
  call('POST', `/payments/${s.paymentId}/cancel`, { headers: c.headers, body: {} });
export const requestVoid = (c: Cashier, s: Sale, reason: string) =>
  call<{ id: string }>('POST', `/transactions/${s.id}/void-requests`, {
    headers: c.headers,
    body: { reason },
  });
