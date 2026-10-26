import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { employees, outletSettings, users } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { pinFingerprint } from '../../lib/crypto.js';
import { hashSecret } from '../../lib/passwords.js';
import { decodeQrFromImage } from '../../lib/qr-image.js';
import { parseQris, QrisError } from '../../lib/qris.js';
import { imageUrlSchema } from '../../lib/urls.js';
import { parse } from '../../lib/validate.js';
import { requestOutletId, requireUser, type Guards } from '../../plugins/auth.js';
import { writeAudit } from '../audit/audit.js';
import { loadSettings, toSettings } from './serialize.js';

/** Largest QRIS image accepted for decoding (matches the 2 MiB upload cap) as base64. */
const MAX_DECODE_BODY = 3 * 1024 * 1024;

const rupiah = z.number().int().min(1).max(100_000_000);

export function settingsRoutes(ctx: AppContext, guards: Guards) {
  const { db, config } = ctx;
  const url = imageUrlSchema(config.storage?.publicBaseUrl);
  const text = (max: number) =>
    z
      .string()
      .trim()
      .max(max)
      .transform((v) => (v === '' ? null : v));
  const updateBody = z
    .object({
      display_name: z.string().trim().min(1).max(60),
      address: text(200).nullable(),
      phone: text(20).nullable(),
      logo_url: url.nullable(),
      receipt_header: text(200).nullable(),
      receipt_footer: text(200).nullable(),
      qris_static_payload: z.string().trim().max(600).nullable(),
      qris_static_image_url: url.nullable(),
      qris_embed_amount: z.boolean(),
      offline_login_enabled: z.boolean(),
      quick_cash_amounts: z.array(rupiah).max(6),
      owner_pin: z.string().regex(/^[0-9]{6}$/, 'PIN must be 6 digits'),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/settings', { preHandler: guards.ownerOrDevice }, async (req) => {
      const { outlet, settings } = await loadSettings(db, requestOutletId(req));
      return toSettings(outlet, settings);
    });

    app.patch('/settings', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const body = parse(updateBody, req.body);

      let qris: { payload: string | null; merchantName: string | null } | undefined;
      if (body.qris_static_payload !== undefined) {
        if (body.qris_static_payload === null || body.qris_static_payload === '') {
          qris = { payload: null, merchantName: null };
        } else {
          try {
            const parsed = parseQris(body.qris_static_payload);
            qris = { payload: body.qris_static_payload, merchantName: parsed.merchantName };
          } catch (err) {
            if (!(err instanceof QrisError)) throw err;
            throw errors.unprocessable('INVALID_QRIS_PAYLOAD', 'Invalid QRIS payload', err.message);
          }
        }
      }

      const ownerPinHash = body.owner_pin ? await hashSecret(body.owner_pin) : undefined;

      return db.transaction(async (tx) => {
        const { outlet, settings: before } = await loadSettings(tx, principal.outletId);

        // The image and "embed amount" only make sense with a valid code: every QRIS sale needs the
        // payload, so reject the combination here and not only in the dashboard.
        const nextPayload = qris ? qris.payload : before.qrisStaticPayload;
        const nextImage =
          body.qris_static_image_url !== undefined
            ? body.qris_static_image_url
            : before.qrisStaticImageUrl;
        const nextEmbed = body.qris_embed_amount ?? before.qrisEmbedAmount;
        if (!nextPayload && (nextImage || nextEmbed)) {
          throw errors.unprocessable(
            'QRIS_PAYLOAD_REQUIRED',
            'QRIS payload required',
            'A QRIS image or qris_embed_amount requires a valid qris_static_payload; decode the image with POST /settings/qris/decode or enter the code manually',
          );
        }

        if (body.owner_pin) {
          // The owner PIN authorises voids on a cashier device, so it must not be an employee PIN.
          const fingerprint = pinFingerprint(
            config.pinFingerprintSecret,
            principal.outletId,
            body.owner_pin,
          );
          const [clash] = await tx
            .select({ id: employees.id })
            .from(employees)
            .where(
              and(
                eq(employees.outletId, principal.outletId),
                eq(employees.pinFingerprint, fingerprint),
                eq(employees.isActive, true),
              ),
            )
            .limit(1);
          if (clash) {
            throw errors.conflict(
              'PIN_NOT_UNIQUE',
              'PIN already in use',
              'The owner PIN must differ from every employee PIN',
            );
          }
        }

        const [row] = await tx
          .update(outletSettings)
          .set({
            updatedAt: ctx.now(),
            ...(body.display_name !== undefined ? { displayName: body.display_name } : {}),
            ...(body.address !== undefined ? { address: body.address } : {}),
            ...(body.phone !== undefined ? { phone: body.phone } : {}),
            ...(body.logo_url !== undefined ? { logoUrl: body.logo_url } : {}),
            ...(body.receipt_header !== undefined ? { receiptHeader: body.receipt_header } : {}),
            ...(body.receipt_footer !== undefined ? { receiptFooter: body.receipt_footer } : {}),
            ...(qris
              ? { qrisStaticPayload: qris.payload, qrisMerchantName: qris.merchantName }
              : {}),
            ...(body.qris_static_image_url !== undefined
              ? { qrisStaticImageUrl: body.qris_static_image_url }
              : {}),
            ...(body.qris_embed_amount !== undefined
              ? { qrisEmbedAmount: body.qris_embed_amount }
              : {}),
            ...(body.offline_login_enabled !== undefined
              ? { offlineLoginEnabled: body.offline_login_enabled }
              : {}),
            ...(body.quick_cash_amounts !== undefined
              ? { quickCashAmounts: body.quick_cash_amounts }
              : {}),
          })
          .where(eq(outletSettings.outletId, principal.outletId))
          .returning();
        if (!row) throw new Error('failed to update settings');

        if (ownerPinHash) {
          await tx.update(users).set({ ownerPinHash }).where(eq(users.id, principal.id));
        }
        if (
          body.offline_login_enabled !== undefined &&
          body.offline_login_enabled !== before.offlineLoginEnabled
        ) {
          // Employee rows carry the PIN hashes in `/sync/pull`; touching them re-sends them (or
          // stops sending them) to every device.
          await tx
            .update(employees)
            .set({ isActive: employees.isActive })
            .where(eq(employees.outletId, principal.outletId));
        }

        const view = toSettings(outlet, before);
        const next = toSettings(outlet, row);
        const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
          (k) => JSON.stringify(view[k]) !== JSON.stringify(next[k]),
        );
        await writeAudit(tx, {
          outletId: principal.outletId,
          actor: { type: 'user', id: principal.id },
          action: 'settings.updated',
          entityType: 'outlet_settings',
          entityId: principal.outletId,
          before: Object.fromEntries(changed.map((k) => [k, view[k]])),
          after: Object.fromEntries(changed.map((k) => [k, next[k]])),
          // The owner PIN itself is never recorded, only the fact that it changed.
          meta: { owner_pin_changed: Boolean(ownerPinHash) },
        });
        return next;
      });
    });

    app.post(
      '/settings/qris/decode',
      { preHandler: guards.owner, bodyLimit: MAX_DECODE_BODY },
      async (req) => {
        requireUser(req);
        const body = parse(z.object({ image_base64: z.string().min(1) }), req.body);
        const bytes = Buffer.from(body.image_base64, 'base64');
        if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) {
          throw errors.validation([
            { path: 'image_base64', message: 'Image must be between 1 byte and 2 MiB' },
          ]);
        }
        let raw: string | null;
        try {
          raw = decodeQrFromImage(bytes);
        } catch {
          raw = null;
        }
        if (!raw) {
          throw errors.unprocessable(
            'INVALID_QRIS_PAYLOAD',
            'Invalid QRIS payload',
            'No QR code could be read from the image; upload a PNG or JPEG or paste the payload',
          );
        }
        try {
          const parsed = parseQris(raw);
          return {
            qris_static_payload: raw.trim(),
            qris_merchant_name: parsed.merchantName,
            is_static: parsed.initiationMethod === '11',
          };
        } catch (err) {
          if (!(err instanceof QrisError)) throw err;
          throw errors.unprocessable('INVALID_QRIS_PAYLOAD', 'Invalid QRIS payload', err.message);
        }
      },
    );
  };
}
