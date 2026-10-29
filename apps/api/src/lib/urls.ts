import { z } from 'zod';
import type { StorageConfig } from '../config.js';

/** Path of the stable media endpoint, relative to the API public base URL (ADR-0015). */
export const MEDIA_PATH = '/v1/media/';

/** URL prefixes image fields may point to: the API media endpoint and, if set, a legacy public bucket. */
export function allowedImagePrefixes(storage: StorageConfig | null): string[] {
  if (!storage) return [];
  const prefixes = [`${storage.apiPublicBaseUrl}${MEDIA_PATH}`];
  if (storage.publicBaseUrl) prefixes.push(`${storage.publicBaseUrl}/`);
  return prefixes;
}

/**
 * Image URLs must be plain http(s) and, when object storage is configured, live under the API media
 * endpoint (or the legacy public bucket URL), so clients cannot make receipts and the app load
 * arbitrary third-party content.
 */
export function imageUrlSchema(storage: StorageConfig | null) {
  const prefixes = allowedImagePrefixes(storage);
  return z
    .url({ protocol: /^https?$/ })
    .max(500)
    .refine((u) => prefixes.length === 0 || prefixes.some((p) => u.startsWith(p)), {
      message: 'URL must point to the uploaded files location',
    });
}
