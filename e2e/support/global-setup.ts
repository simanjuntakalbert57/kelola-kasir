import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  bearer,
  buildQris,
  call,
  cancelQris,
  closeShift,
  confirmQris,
  createCashier,
  openShift,
  ownerToken,
  requestVoid,
  sell,
  startNumbering,
  type Product,
  type Shop,
} from './api.js';

export const STATE_FILE = fileURLToPath(new URL('../.seed-state.json', import.meta.url));

/**
 * Seeds one outlet through the public API only (like a real owner + cashier would):
 *   shift 1 (Siti, closed): modal 100.000, cash 30.000 + 12.000, QRIS 15.000 paid, QRIS 15.000 cancelled,
 *                           expected 142.000, actual 137.000 (selisih -5.000)
 *   shift 2 (Budi, open):   cash 45.000, cash 24.000, QRIS 12.000 paid; two void requests pending
 */
export default async function globalSetup(): Promise<void> {
  startNumbering(1);
  const owner = await ownerToken();
  const h = bearer(owner);

  await call('PATCH', '/settings', { headers: h, body: { qris_static_payload: buildQris() } });
  const { data: cat } = await call<{ id: string }>('POST', '/categories', {
    headers: h,
    body: { name: 'Jus Buah' },
  });
  const mk = async (name: string, price: number): Promise<Product> => {
    const { data } = await call<Product>('POST', '/products', {
      headers: h,
      body: { category_id: cat.id, name, price },
    });
    return { id: data.id, name, price };
  };
  const alpukat = await mk('Jus Alpukat', 15_000);
  const jeruk = await mk('Jus Jeruk', 12_000);

  const created = await call<{ device: { id: string; code: string }; pairing_code: string }>(
    'POST',
    '/devices',
    { headers: h, body: { name: 'Kasir Depan' } },
  );
  const paired = await call<{ device_token: string }>('POST', '/devices/pair', {
    body: { pairing_code: created.data.pairing_code, app_version: '1.0.0', platform: 'android' },
  });
  const shop: Shop = {
    owner,
    deviceToken: paired.data.device_token,
    deviceId: created.data.device.id,
    deviceCode: created.data.device.code,
    categoryId: cat.id,
    products: { alpukat, jeruk },
  };

  const siti = await createCashier(owner, shop.deviceToken, 'Siti E2E');
  const shift1 = await openShift(siti, 100_000);
  const s1Cash = await sell(shop, siti, shift1, alpukat, 2, 'cash', { tendered: 50_000 });
  await sell(shop, siti, shift1, jeruk, 1, 'cash', { tendered: 12_000, buyer: 'Pak Haji' });
  await confirmQris(siti, await sell(shop, siti, shift1, alpukat, 1, 'qris'));
  await cancelQris(siti, await sell(shop, siti, shift1, alpukat, 1, 'qris'));
  const closed = await closeShift(siti, shift1, 137_000);

  const budi = await createCashier(owner, shop.deviceToken, 'Budi E2E');
  const shift2 = await openShift(budi, 50_000);
  await sell(shop, budi, shift2, alpukat, 3, 'cash', { tendered: 50_000 });
  const v1 = await sell(shop, budi, shift2, jeruk, 2, 'cash');
  const v2 = await sell(shop, budi, shift2, jeruk, 1, 'cash');
  await confirmQris(budi, await sell(shop, budi, shift2, jeruk, 1, 'qris'));
  await requestVoid(budi, v1, 'Salah input pesanan');
  await requestVoid(budi, v2, 'Pembeli batal');

  writeFileSync(
    STATE_FILE,
    JSON.stringify(
      { shop, siti, budi, shift1, shift2, shift1Close: closed.data, v1, v2, s1Cash },
      null,
      2,
    ),
  );
}
