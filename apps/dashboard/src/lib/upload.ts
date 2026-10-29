import { post } from './api';

export type UploadPurpose = 'product_image' | 'logo' | 'qris_image';
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

interface PresignedUpload {
  upload_url: string;
  upload_headers?: Record<string, string>;
  public_url: string;
  expires_at: string;
}

/** Base64 SHA-256 of the file; required by buckets with Object Lock (B2) on PUT. */
async function sha256Base64(file: File): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return btoa(String.fromCharCode(...digest));
}

/** Validates the file, asks the API for a presigned PUT URL, uploads, and returns the public URL. */
export async function uploadImage(file: File, purpose: UploadPurpose): Promise<string> {
  if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    throw new Error('Format gambar harus JPG, PNG, atau WebP.');
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Ukuran gambar maksimal 2 MB.');
  const checksum = await sha256Base64(file);
  const presigned = await post<PresignedUpload>('/uploads', {
    purpose,
    content_type: file.type,
    size_bytes: file.size,
    checksum_sha256: checksum,
  });
  const res = await fetch(presigned.upload_url, {
    method: 'PUT',
    headers: presigned.upload_headers ?? {
      'Content-Type': file.type,
      'x-amz-checksum-sha256': checksum,
    },
    body: file,
  });
  if (!res.ok) throw new Error('Gagal mengunggah gambar. Coba lagi.');
  return presigned.public_url;
}
