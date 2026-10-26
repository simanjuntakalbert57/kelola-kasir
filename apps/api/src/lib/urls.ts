import { z } from 'zod';

/**
 * Image URLs must be plain http(s) and, when object storage is configured, live under its public
 * base URL, so clients cannot make receipts and the app load arbitrary third-party content.
 */
export function imageUrlSchema(publicBaseUrl: string | undefined) {
  return z
    .url({ protocol: /^https?$/ })
    .max(500)
    .refine((u) => !publicBaseUrl || u.startsWith(`${publicBaseUrl}/`), {
      message: 'URL must point to the uploaded files location',
    });
}
