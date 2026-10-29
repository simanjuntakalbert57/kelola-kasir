import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { errors } from '../../errors.js';
import { presignUrl } from '../../lib/presign.js';
import { MEDIA_PATH } from '../../lib/urls.js';
import { parse } from '../../lib/validate.js';
import { requireUser, type Guards } from '../../plugins/auth.js';

const MAX_BYTES = 2 * 1024 * 1024;
const UPLOAD_TTL_SEC = 10 * 60;
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

const body = z.object({
  purpose: z.enum(['product_image', 'logo', 'qris_image']),
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size_bytes: z.number().int().min(1).max(MAX_BYTES),
  /**
   * Base64 SHA-256 of the file. Buckets with Object Lock (B2) reject a PUT without a checksum
   * header, so the client sends it here and the API signs it into the URL.
   */
  checksum_sha256: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/)
    .optional(),
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
      if (!storage) {
        throw errors.unavailable(
          'UPLOADS_NOT_CONFIGURED',
          'Uploads are not configured',
          'Object storage is not set up for this environment',
        );
      }
      const now = ctx.now();
      const key = `${principal.outletId}/${input.purpose}/${randomUUID()}.${EXTENSIONS[input.content_type]}`;
      const uploadUrl = presignUrl({
        method: 'PUT',
        url: `${storage.endpoint}/${storage.bucket}/${key}`,
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
        region: storage.region,
        now,
        expiresInSec: UPLOAD_TTL_SEC,
        // The uploader must send exactly this content type, so a JPEG slot cannot host HTML.
        signedHeaders: {
          'content-type': input.content_type,
          ...(input.checksum_sha256 ? { 'x-amz-checksum-sha256': input.checksum_sha256 } : {}),
        },
      });
      return reply.status(201).send({
        upload_url: uploadUrl,
        // Headers the PUT must carry exactly as given (they are part of the signature).
        upload_headers: {
          'Content-Type': input.content_type,
          ...(input.checksum_sha256 ? { 'x-amz-checksum-sha256': input.checksum_sha256 } : {}),
        },
        public_url: `${storage.apiPublicBaseUrl}${MEDIA_PATH}${key}`,
        expires_at: new Date(now.getTime() + UPLOAD_TTL_SEC * 1000).toISOString(),
      });
    });
  };
}
