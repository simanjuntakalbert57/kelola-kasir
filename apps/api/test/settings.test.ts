import { and, eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, users } from '../src/db/schema.js';
import { verifySecret } from '../src/lib/passwords.js';
import {
  bearer,
  buildQris,
  createEmployee,
  createShop,
  createTestEnv,
  get,
  json,
  loginOwner,
  patch,
  post,
  seedOutlet,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.close();
});

interface SettingsDto {
  outlet: { code: string };
  display_name: string;
  address: string | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  qris_mode: string;
  qris_static_payload: string | null;
  qris_merchant_name: string | null;
  qris_embed_amount: boolean;
  offline_login_enabled: boolean;
  quick_cash_amounts: number[];
}

describe('store settings', () => {
  it('returns defaults to the owner and to a paired device', async () => {
    const seeded = await seedOutlet(env);
    const owner = await loginOwner(env, seeded);
    const res = await get(env, '/v1/settings', bearer(owner.token));
    expect(res.statusCode).toBe(200);
    expect(json<SettingsDto>(res)).toMatchObject({
      outlet: { code: seeded.code },
      qris_mode: 'static',
      qris_static_payload: null,
      qris_embed_amount: false,
      offline_login_enabled: false,
      quick_cash_amounts: [20_000, 50_000, 100_000],
    });
    const shop = await createShop(env);
    const viaDevice = await get(env, '/v1/settings', { 'x-device-token': shop.device.token });
    expect(viaDevice.statusCode).toBe(200);
    expect((await get(env, '/v1/settings', {})).statusCode).toBe(401);
  });

  it('updates the receipt header and footer, trimming and clearing empty values', async () => {
    const shop = await createShop(env, { qris: false });
    const owner = bearer(shop.ownerToken);
    const res = await patch(env, '/v1/settings', owner, {
      display_name: 'Jus Segar',
      address: ' Jl. Melati 5, Medan ',
      receipt_header: '@jussegar',
      receipt_footer: 'Terima kasih!',
      quick_cash_amounts: [10_000, 20_000],
    });
    expect(res.statusCode).toBe(200);
    expect(json<SettingsDto>(res)).toMatchObject({
      display_name: 'Jus Segar',
      address: 'Jl. Melati 5, Medan',
      receipt_header: '@jussegar',
      receipt_footer: 'Terima kasih!',
      quick_cash_amounts: [10_000, 20_000],
    });
    const cleared = await patch(env, '/v1/settings', owner, { receipt_header: '  ' });
    expect(json<SettingsDto>(cleared).receipt_header).toBeNull();
    // Untouched fields stay.
    expect(json<SettingsDto>(cleared).receipt_footer).toBe('Terima kasih!');
  });

  it('validates field limits', async () => {
    const shop = await createShop(env, { qris: false });
    const owner = bearer(shop.ownerToken);
    for (const body of [
      {},
      { display_name: '' },
      { display_name: 'x'.repeat(61) },
      { receipt_footer: 'x'.repeat(201) },
      { quick_cash_amounts: [1, 2, 3, 4, 5, 6, 7] },
      { quick_cash_amounts: [0] },
      { owner_pin: '12345' },
      { logo_url: 'ftp://x/y.png' },
    ]) {
      expect((await patch(env, '/v1/settings', owner, body)).statusCode, JSON.stringify(body)).toBe(
        400,
      );
    }
  });

  it('is owner-only for writes', async () => {
    const shop = await createShop(env);
    expect(
      (await patch(env, '/v1/settings', shop.cashier.headers, { display_name: 'X' })).statusCode,
    ).toBe(403);
    expect(
      (
        await patch(
          env,
          '/v1/settings',
          { 'x-device-token': shop.device.token },
          { display_name: 'X' },
        )
      ).statusCode,
    ).toBe(401);
  });

  it('audits the changed fields only', async () => {
    const shop = await createShop(env, { qris: false });
    await patch(env, '/v1/settings', bearer(shop.ownerToken), { receipt_footer: 'Sampai jumpa' });
    const [entry] = await env.handle.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.outletId, shop.seeded.outletId), eq(auditLogs.action, 'settings.updated')),
      );
    expect(entry?.before).toEqual({ receipt_footer: null });
    expect(entry?.after).toEqual({ receipt_footer: 'Sampai jumpa' });
  });
});

describe('static QRIS settings', () => {
  it('stores a valid payload and learns the merchant name from it', async () => {
    const shop = await createShop(env, { qris: false });
    const payload = buildQris('KEDAI JUS MEDAN');
    const res = await patch(env, '/v1/settings', bearer(shop.ownerToken), {
      qris_static_payload: payload,
      qris_embed_amount: true,
    });
    expect(res.statusCode).toBe(200);
    expect(json<SettingsDto>(res)).toMatchObject({
      qris_static_payload: payload,
      qris_merchant_name: 'KEDAI JUS MEDAN',
      qris_embed_amount: true,
    });
    const cleared = await patch(env, '/v1/settings', bearer(shop.ownerToken), {
      qris_static_payload: null,
      qris_embed_amount: false,
    });
    expect(json<SettingsDto>(cleared)).toMatchObject({
      qris_static_payload: null,
      qris_merchant_name: null,
    });
  });

  it.each([
    ['garbage', 'not a qris code at all, just some words that are long enough to pass length'],
    ['bad CRC', buildQris().slice(0, -4) + 'FFFF'],
  ])('rejects %s with INVALID_QRIS_PAYLOAD', async (_name, payload) => {
    const shop = await createShop(env, { qris: false });
    const res = await patch(env, '/v1/settings', bearer(shop.ownerToken), {
      qris_static_payload: payload,
    });
    expect(res.statusCode).toBe(422);
    expect(json(res)).toMatchObject({ code: 'INVALID_QRIS_PAYLOAD' });
  });

  it('rejects a QRIS image or embed amount without a payload (QRIS_PAYLOAD_REQUIRED)', async () => {
    const shop = await createShop(env, { qris: false });
    const owner = bearer(shop.ownerToken);
    const image = 'https://example.test/qris.png';
    for (const body of [
      { qris_static_image_url: image },
      { qris_embed_amount: true },
      { qris_static_image_url: image, qris_static_payload: null, qris_embed_amount: true },
    ]) {
      const res = await patch(env, '/v1/settings', owner, body);
      expect(res.statusCode).toBe(422);
      expect(json(res)).toMatchObject({ code: 'QRIS_PAYLOAD_REQUIRED' });
    }
    expect(json<SettingsDto>(await get(env, '/v1/settings', owner))).toMatchObject({
      qris_static_payload: null,
      qris_embed_amount: false,
    });

    // With a valid payload the same image is accepted; clearing the payload while the image stays is not.
    const ok = await patch(env, '/v1/settings', owner, {
      qris_static_image_url: image,
      qris_static_payload: buildQris(),
    });
    expect(ok.statusCode).toBe(200);
    const clear = await patch(env, '/v1/settings', owner, { qris_static_payload: null });
    expect(clear.statusCode).toBe(422);
    expect(json(clear)).toMatchObject({ code: 'QRIS_PAYLOAD_REQUIRED' });
    const both = await patch(env, '/v1/settings', owner, {
      qris_static_payload: null,
      qris_static_image_url: null,
    });
    expect(both.statusCode).toBe(200);
  });

  it('decodes the payload from an uploaded QR image', async () => {
    const shop = await createShop(env, { qris: false });
    const payload = buildQris('FOTO QRIS');
    const png = await QRCode.toBuffer(payload, { type: 'png', margin: 4, scale: 6 });
    const res = await post(env, '/v1/settings/qris/decode', bearer(shop.ownerToken), {
      image_base64: png.toString('base64'),
    });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({
      qris_static_payload: payload,
      qris_merchant_name: 'FOTO QRIS',
      is_static: true,
    });
  });

  it('says so when the image holds no QRIS code', async () => {
    const shop = await createShop(env, { qris: false });
    const owner = bearer(shop.ownerToken);
    const other = await QRCode.toBuffer('https://example.com', { type: 'png' });
    for (const image_base64 of [
      Buffer.from('plain text').toString('base64'),
      other.toString('base64'),
    ]) {
      const res = await post(env, '/v1/settings/qris/decode', owner, { image_base64 });
      expect(res.statusCode).toBe(422);
      expect(json(res)).toMatchObject({ code: 'INVALID_QRIS_PAYLOAD' });
    }
    expect((await post(env, '/v1/settings/qris/decode', owner, {})).statusCode).toBe(400);
    expect(
      (await post(env, '/v1/settings/qris/decode', shop.cashier.headers, { image_base64: 'AAAA' }))
        .statusCode,
    ).toBe(403);
  });
});

describe('owner PIN', () => {
  it('is stored hashed and never echoed or audited', async () => {
    const shop = await createShop(env, { qris: false });
    const res = await patch(env, '/v1/settings', bearer(shop.ownerToken), { owner_pin: '654321' });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('654321');
    const [owner] = await env.handle.db
      .select({ hash: users.ownerPinHash })
      .from(users)
      .where(eq(users.email, shop.seeded.ownerEmail));
    expect(owner?.hash).toBeTruthy();
    expect(await verifySecret(owner?.hash ?? '', '654321')).toBe(true);
    const trail = await env.handle.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.outletId, shop.seeded.outletId), eq(auditLogs.action, 'settings.updated')),
      );
    expect(JSON.stringify(trail)).not.toContain('654321');
    expect(trail[0]?.meta).toMatchObject({ owner_pin_changed: true });
  });

  it('must differ from every active employee PIN', async () => {
    const shop = await createShop(env, { qris: false });
    const employee = await createEmployee(env, shop.ownerToken, 'Dewi', '246810');
    const res = await patch(env, '/v1/settings', bearer(shop.ownerToken), {
      owner_pin: employee.pin,
    });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ code: 'PIN_NOT_UNIQUE' });
  });
});

describe('uploads', () => {
  const storage = {
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    bucket: 'media',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'secret-example',
    region: 'auto',
    apiPublicBaseUrl: 'https://api.example',
  };

  it('answers 503 when storage is not configured', async () => {
    const shop = await createShop(env, { qris: false });
    const res = await post(env, '/v1/uploads', bearer(shop.ownerToken), {
      purpose: 'logo',
      content_type: 'image/png',
      size_bytes: 1000,
    });
    expect(res.statusCode).toBe(503);
    expect(json(res)).toMatchObject({ code: 'UPLOADS_NOT_CONFIGURED' });
  });

  it('hands out a presigned PUT url scoped to the outlet and purpose', async () => {
    const withStorage = await createTestEnv({ storage });
    try {
      const seeded = await seedOutlet(withStorage);
      const owner = await loginOwner(withStorage, seeded);
      const res = await post(withStorage, '/v1/uploads', bearer(owner.token), {
        purpose: 'product_image',
        content_type: 'image/webp',
        size_bytes: 150_000,
      });
      expect(res.statusCode).toBe(201);
      const body = json<{ upload_url: string; public_url: string; expires_at: string }>(res);
      const upload = new URL(body.upload_url);
      expect(upload.origin).toBe('https://acct.r2.cloudflarestorage.com');
      expect(upload.pathname).toMatch(
        new RegExp(`^/media/${seeded.outletId}/product_image/[0-9a-f-]{36}\\.webp$`),
      );
      expect(upload.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
      expect(upload.searchParams.get('X-Amz-Expires')).toBe('600');
      expect(upload.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      expect(body.public_url).toBe(
        `https://api.example/v1/media${upload.pathname.replace('/media', '')}`,
      );
      expect(new Date(body.expires_at).getTime()).toBeGreaterThan(withStorage.clock.now.getTime());
      expect(body.upload_url).not.toContain('secret-example');
    } finally {
      await withStorage.close();
    }
  });

  it('signs the SHA-256 checksum header when the client sends one', async () => {
    const withStorage = await createTestEnv({ storage });
    try {
      const shop = await createShop(withStorage, { qris: false });
      const owner = bearer(shop.ownerToken);
      const checksum = 'n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg=';
      const res = await post(withStorage, '/v1/uploads', owner, {
        purpose: 'logo',
        content_type: 'image/png',
        size_bytes: 1000,
        checksum_sha256: checksum,
      });
      expect(res.statusCode).toBe(201);
      const body = json<{ upload_url: string; upload_headers: Record<string, string> }>(res);
      expect(new URL(body.upload_url).searchParams.get('X-Amz-SignedHeaders')).toBe(
        'content-type;host;x-amz-checksum-sha256',
      );
      expect(body.upload_headers).toEqual({
        'Content-Type': 'image/png',
        'x-amz-checksum-sha256': checksum,
      });
      const bad = await post(withStorage, '/v1/uploads', owner, {
        purpose: 'logo',
        content_type: 'image/png',
        size_bytes: 1000,
        checksum_sha256: 'not-a-checksum',
      });
      expect(bad.statusCode).toBe(400);
    } finally {
      await withStorage.close();
    }
  });

  it('validates purpose, type and size, and is owner-only', async () => {
    const withStorage = await createTestEnv({ storage });
    try {
      const shop = await createShop(withStorage, { qris: false });
      const owner = bearer(shop.ownerToken);
      const ok = { purpose: 'logo', content_type: 'image/png', size_bytes: 1000 };
      for (const bad of [
        { ...ok, purpose: 'avatar' },
        { ...ok, content_type: 'text/html' },
        { ...ok, size_bytes: 2 * 1024 * 1024 + 1 },
        { ...ok, size_bytes: 0 },
      ]) {
        expect((await post(withStorage, '/v1/uploads', owner, bad)).statusCode).toBe(400);
      }
      expect((await post(withStorage, '/v1/uploads', shop.cashier.headers, ok)).statusCode).toBe(
        403,
      );
    } finally {
      await withStorage.close();
    }
  });
});
