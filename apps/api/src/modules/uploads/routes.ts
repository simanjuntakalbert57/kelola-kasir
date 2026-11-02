import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { and, eq } from 'drizzle-orm';
import { outletMembers } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { presignUrl } from '../../lib/presign.js';
import { MEDIA_PATH } from '../../lib/urls.js';
import { parse, uuid } from '../../lib/validate.js';
import { requireUser, type Guards } from '../../plugins/auth.js';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 300 * 1024;
const UPLOAD_TTL_SEC = 10 * 60;
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

const body = z.object({
  purpose: z.enum(['product_image', 'logo', 'qris_image', 'expense_receipt']),
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size_bytes: z.number().int().min(1).max(MAX_BYTES),
  outlet_id: uuid.optional(),
});

/**
 * Presigned PUT uploads to S3-compatible storage (O-04, O-10). Objects are namespaced per outlet and
 * the bucket is private: `public_url` is the stable API media URL (ADR-0015).
 */
export function uploadRoutes(ctx: AppContext, guards: Guards) {
  const { storage } = ctx.config;

  return async (app: FastifyInstance): Promise<void> => {
    app.post('/uploads', { preHandler: guards.owner }, async (req, reply) => {
      const principal = requireUser(req);
      const input = parse(body, req.body);
      if (input.purpose === 'expense_receipt' && input.size_bytes > MAX_RECEIPT_BYTES) {
        throw errors.validation([
          { path: 'size_bytes', message: `A receipt can be at most ${MAX_RECEIPT_BYTES} bytes` },
        ]);
      }
      if (input.outlet_id && input.purpose !== 'expense_receipt') {
        throw errors.validation([
          { path: 'outlet_id', message: 'outlet_id is only allowed for expense_receipt' },
        ]);
      }
      if (!storage) {
        throw errors.unavailable(
          'UPLOADS_NOT_CONFIGURED',
          'Uploads are not configured',
          'Object storage is not set up for this environment',
        );
      }
      let outletId = principal.outletId;
      if (input.outlet_id && input.outlet_id !== principal.outletId) {
        // A receipt may be uploaded for another branch where the caller is a member (ADR-0020).
        const [member] = await ctx.db
          .select({ outletId: outletMembers.outletId })
          .from(outletMembers)
          .where(
            and(
              eq(outletMembers.userId, principal.id),
              eq(outletMembers.outletId, input.outlet_id),
            ),
          )
          .limit(1);
        if (!member) throw errors.forbidden('You are not a member of that outlet');
        outletId = input.outlet_id;
      }
      const now = ctx.now();
      const key = `${outletId}/${input.purpose}/${randomUUID()}.${EXTENSIONS[input.content_type]}`;
      const uploadUrl = presignUrl({
        method: 'PUT',
        url: `${storage.endpoint}/${storage.bucket}/${key}`,
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
        region: storage.region,
        now,
        expiresInSec: UPLOAD_TTL_SEC,
        // The uploader must send exactly this content type, so a JPEG slot cannot host HTML.
        signedHeaders: { 'content-type': input.content_type },
      });
      return reply.status(201).send({
        upload_url: uploadUrl,
        public_url: `${storage.apiPublicBaseUrl}${MEDIA_PATH}${key}`,
        expires_at: new Date(now.getTime() + UPLOAD_TTL_SEC * 1000).toISOString(),
      });
    });
  };
}
