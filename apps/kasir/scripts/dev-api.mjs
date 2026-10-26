// Tiny stateful fake of the endpoints M-1..M-5 use, for screenshots and manual testing when Prism's
// static examples are not enough (Prism always returns an open shift, never 204/401/423).
// Usage: node scripts/dev-api.mjs [port]. Pairing code: AB12CD34. PIN for everyone: 123456.
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4011);
const employees = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Sari' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Budi' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Dewi' },
];
const outlet = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  code: 'JUS1',
  name: 'Jus Albert',
  timezone: 'Asia/Jakarta',
};
const device = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  code: 'K01',
  name: 'HP Kasir 1',
  status: 'active',
};
let shift = null;
const failures = {};

const send = (res, status, body) => {
  res.writeHead(status, {
    'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
};
const problem = (res, status, code, title) =>
  send(res, status, { type: 'about:blank', title, status, code });

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  const route = `${req.method} ${req.url.split('?')[0]}`;
  if (route === 'POST /devices/pair') {
    if (body.pairing_code !== 'AB12CD34') return problem(res, 400, 'INVALID_CODE', 'Invalid code');
    return send(res, 200, { device, device_token: 'dev-token', outlet });
  }
  if (req.headers['x-device-token'] !== 'dev-token')
    return problem(res, 401, 'DEVICE_REVOKED', 'Unauthorized');
  if (route === 'GET /devices/me/employees') return send(res, 200, { data: employees });
  if (route === 'GET /sync/pull')
    return send(res, 200, { next_cursor: '1', has_more: false, changes: {} });
  if (route === 'POST /auth/pin-login') {
    const e = employees.find((x) => x.id === body.employee_id);
    if ((failures[body.employee_id] ?? 0) >= 5) return problem(res, 423, 'PIN_LOCKED', 'Locked');
    if (!e || body.pin !== '123456') {
      failures[body.employee_id] = (failures[body.employee_id] ?? 0) + 1;
      return problem(res, 401, 'INVALID_PIN', 'Invalid PIN');
    }
    failures[e.id] = 0;
    return send(res, 200, {
      access_token: `jwt-${e.id}`,
      expires_in: 43200,
      employee: { ...e, is_active: true },
    });
  }
  if (route === 'POST /auth/pin-logout') return send(res, 204);
  if (route === 'GET /shifts/current') return shift ? send(res, 200, shift) : send(res, 204);
  if (route === 'POST /shifts') {
    const token = req.headers.authorization ?? '';
    const opener = employees.find((e) => token.endsWith(e.id)) ?? employees[0];
    shift = {
      id: body.id,
      opened_on_device_id: device.id,
      opened_by: { ...opener, is_active: true },
      status: 'open',
      opening_cash: body.opening_cash,
      opened_at: body.opened_at,
    };
    return send(res, 201, shift);
  }
  return problem(res, 404, 'NOT_FOUND', route);
}).listen(port, '0.0.0.0', () => console.warn(`dev-api on :${port}`));
