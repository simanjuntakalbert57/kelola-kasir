import { parseRupiah } from '@kelola-kasir/money';

const dateTime = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jakarta',
});

/** Format an ISO timestamp in WIB, or "—" when missing. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${dateTime.format(new Date(iso))} WIB`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Terjadi kesalahan. Coba lagi.';
}

/** Rupiah text input → integer. Returns null for empty or invalid input (decimals are rejected). */
export function toRupiah(input: string): number | null {
  try {
    return parseRupiah(input);
  } catch {
    return null;
  }
}
