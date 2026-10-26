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
