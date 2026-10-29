import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { errors } from '../../errors.js';
import { presignUrl } from '../../lib/presign.js';

const DOWNLOAD_TTL_SEC = 10 * 60;
const CLIENT_CACHE_SEC = 5 * 60;

/** Only keys this API itself issues (`<outletId>/<purpose>/<uuid>.<ext>`); nothing else in the bucket is reachable. */
export const MEDIA_KEY =
  /^[0-9a-f-]{36}\/(product_image|logo|qris_image)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/**
 * Stable image URLs for a private bucket (ADR-0015). No auth: `<img>` cannot send a bearer token, and
 * the random UUID in the key is the capability. Answers a short-lived presigned GET redirect.
 */
export function mediaRoutes(ctx: AppContext) {
  const { storage } = ctx.config;

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/media/*', async (req, reply) => {
      const key = (req.params as { '*': string })['*'];
      if (!MEDIA_KEY.test(key)) throw errors.notFound('Media not found');
      if (!storage) {
        throw errors.unavailable(
          'UPLOADS_NOT_CONFIGURED',
          'Uploads are not configured',
          'Object storage is not set up for this environment',
        );
      }
      const location = presignUrl({
        method: 'GET',
        url: `${storage.endpoint}/${storage.bucket}/${key}`,
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
        region: storage.region,
        now: ctx.now(),
        expiresInSec: DOWNLOAD_TTL_SEC,
      });
      return reply
        .header('cache-control', `private, max-age=${CLIENT_CACHE_SEC}`)
        .redirect(location, 302);
    });
  };
}
