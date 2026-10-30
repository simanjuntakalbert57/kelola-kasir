import { useQueryClient } from '@tanstack/react-query';
import { PRODUCT_IMPORT_LIMITS } from '@kelola-kasir/contracts';
import type {
  ProductImportPreview,
  ProductImportResult,
  ProductImportRow,
} from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { Link, useRouter } from '@tanstack/react-router';
import { Check, Plus, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { Alert, Button, Card, ConfirmDialog, PageHeader, Toast } from '../components/ui';
import { ApiError, api, download } from '../lib/api';
import { useIsDesktop } from '../lib/useMediaQuery';
import { useUnsavedWarning } from '../lib/useUnsavedWarning';

type Filter = 'all' | 'create' | 'update' | 'unchanged' | 'error';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'create', label: 'Baru' },
  { key: 'update', label: 'Diperbarui' },
  { key: 'unchanged', label: 'Tidak berubah' },
  { key: 'error', label: 'Error' },
];

const ACTION_LABEL = {
  create: 'Baru',
  update: 'Diperbarui',
  unchanged: 'Tidak berubah',
  error: 'Error',
} as const;

/** Maps API failures to the final copy of the design (docs/design/impor-produk.html §E.2). */
export function importErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 413:
        return 'File terlalu besar. Maksimal 2 MB. Bagi menjadi beberapa file lebih kecil.';
      case 415:
        return 'File tidak bisa dibaca. Gunakan file .xlsx atau .csv. Unduh template di langkah 1.';
      case 429:
        return 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.';
    }
    if (error.code === 'IMPORT_FILE_UNREADABLE')
      return 'File tidak bisa dibuka. Simpan ulang dari Excel sebagai .xlsx atau .csv (tanpa sandi), lalu coba lagi.';
    return error.message;
  }
  return 'Gagal mengirim file. Periksa koneksi internet lalu coba lagi. Belum ada yang disimpan.';
}

/** Client-side file check before uploading (extension and size, ADR-0018 limits). */
export function checkImportFile(file: File): string | null {
  if (!/\.(csv|xlsx)$/i.test(file.name)) return importErrorMessage(new ApiError(415, '', ''));
  if (file.size > PRODUCT_IMPORT_LIMITS.maxBytes)
    return importErrorMessage(new ApiError(413, '', ''));
  return null;
}

function toFormData(file: File, token?: string): FormData {
  const form = new FormData();
  form.set('file', file);
  if (token) form.set('import_token', token);
  return form;
}

const post = <T,>(path: string, body: FormData) => api<T>(path, { method: 'POST', body });

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const csvCell = (v: string) => `"${v.replaceAll('"', '""')}"`;

function errorListCsv(rows: ProductImportRow[]): Blob {
  const lines = ['baris;kolom;pesan'];
  for (const r of rows)
    for (const e of r.errors) lines.push([r.row, e.column ?? '', csvCell(e.message)].join(';'));
  return new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
}

function SummaryTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <div className={`flex-1 rounded-2xl px-3 py-2.5 ${value === 0 ? 'bg-bg text-muted' : tone}`}>
      <div className="flex items-center gap-1 text-xs font-extrabold">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-extrabold">{value}</div>
    </div>
  );
}

function Summary({ preview }: { preview: ProductImportPreview }) {
  const s = preview.summary;
  return (
    <div
      role="status"
      aria-label={`${s.create} baru, ${s.update} diperbarui, ${s.unchanged} tidak berubah, ${s.error} error`}
      className="mb-3 flex flex-wrap gap-2"
    >
      <SummaryTile
        label="Baru"
        value={s.create}
        icon={<Plus size={14} aria-hidden="true" />}
        tone="bg-ok-bg text-ok-ink"
      />
      <SummaryTile
        label="Diperbarui"
        value={s.update}
        icon={<RefreshCw size={14} aria-hidden="true" />}
        tone="bg-info-bg text-info-ink"
      />
      <SummaryTile
        label="Tidak berubah"
        value={s.unchanged}
        icon={<Check size={14} aria-hidden="true" />}
        tone="bg-bg text-ink"
      />
      <SummaryTile
        label="Error"
        value={s.error}
        icon={<X size={14} aria-hidden="true" />}
        tone="bg-need-bg text-need-ink"
      />
    </div>
  );
}

function ChangeText({ row }: { row: ProductImportRow }) {
  const price = row.changes.find((c) => c.field === 'price');
  if (row.action !== 'update' || !price) return null;
  return (
    <span className="block text-xs text-muted">
      Harga {formatRupiah(Number(price.before))} → {formatRupiah(Number(price.after))}
    </span>
  );
}

const yn = (v: boolean | null) => (v === null ? '–' : v ? 'Ya' : 'Tidak');

function ActionTag({ row }: { row: ProductImportRow }) {
  const tone =
    row.action === 'error'
      ? 'bg-need-bg text-need-ink'
      : row.action === 'create'
        ? 'bg-ok-bg text-ok-ink'
        : row.action === 'update'
          ? 'bg-info-bg text-info-ink'
          : 'bg-bg text-muted';
  const icon =
    row.action === 'error'
      ? '✕'
      : row.action === 'create'
        ? '＋'
        : row.action === 'update'
          ? '↻'
          : '=';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold ${tone}`}
    >
      <span aria-hidden="true">{icon}</span>
      {ACTION_LABEL[row.action]}
    </span>
  );
}

function RowErrors({ row }: { row: ProductImportRow }) {
  return row.errors.length > 0 ? (
    <ul className="mt-1 text-xs font-bold text-need-ink">
      {row.errors.map((e, i) => (
        <li key={i}>{e.message}</li>
      ))}
    </ul>
  ) : null;
}

function PreviewRows({ rows }: { rows: ProductImportRow[] }) {
  const desktop = useIsDesktop();
  const rowCls = (r: ProductImportRow) => (r.action === 'error' ? 'bg-need-bg text-need-ink' : '');
  if (!desktop)
    return (
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.row} className={`rounded-2xl bg-bg p-3 ${rowCls(r)}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs text-muted">Baris {r.row}</div>
                <div className="truncate font-extrabold">{r.name ?? '(nama kosong)'}</div>
                <div className="text-sm">
                  {r.category ?? '–'}
                  {r.category_is_new ? ' (kategori baru)' : ''} ·{' '}
                  {r.price === null ? '–' : formatRupiah(r.price)}
                </div>
                <ChangeText row={r} />
              </div>
              <ActionTag row={r} />
            </div>
            <RowErrors row={r} />
          </li>
        ))}
      </ul>
    );
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-muted">
        <tr>
          {['Baris', 'Nama', 'Kategori', 'Harga', 'Fav.', 'Aktif', 'Status'].map((h) => (
            <th key={h} scope="col" className="px-2 py-1.5">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.row} className={`border-t border-line align-top ${rowCls(r)}`}>
            <td className="px-2 py-1.5">{r.row}</td>
            <td className="px-2 py-1.5 font-bold">
              {r.name ?? '(kosong)'}
              <RowErrors row={r} />
            </td>
            <td className="px-2 py-1.5">
              {r.category ?? '–'}
              {r.category_is_new ? <span className="block text-xs">kategori baru</span> : null}
            </td>
            <td className="px-2 py-1.5">
              {r.price === null ? '–' : formatRupiah(r.price)}
              <ChangeText row={r} />
            </td>
            <td className="px-2 py-1.5">{yn(r.is_favorite)}</td>
            <td className="px-2 py-1.5">{yn(r.is_active)}</td>
            <td className="px-2 py-1.5">
              <ActionTag row={r} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Phase =
  | { name: 'idle' }
  | { name: 'checking' }
  | { name: 'preview'; preview: ProductImportPreview }
  | { name: 'saving'; preview: ProductImportPreview }
  | { name: 'success'; result: ProductImportResult };

export function ProductImportPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const desktop = useIsDesktop();
  const input = useRef<HTMLInputElement>(null);
  const file = useRef<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [downloading, setDownloading] = useState<'xlsx' | 'csv' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  const hasPreview = phase.name === 'preview' || phase.name === 'saving';
  useUnsavedWarning(hasPreview);
  useEffect(() => {
    if (phase.name === 'success') resultHeading.current?.focus();
  }, [phase.name]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function runPreview(f: File) {
    setPhase({ name: 'checking' });
    setError(null);
    try {
      const preview = await post<ProductImportPreview>('/products/import/preview', toFormData(f));
      file.current = f;
      setFilter(null);
      setPhase({ name: 'preview', preview });
    } catch (e) {
      file.current = null;
      setError(importErrorMessage(e));
      setPhase({ name: 'idle' });
    }
  }

  function pick(f: File | undefined) {
    if (!f) return;
    setNotice(null);
    const problem = checkImportFile(f);
    if (problem) {
      setError(problem);
      return;
    }
    void runPreview(f);
  }

  async function save(preview: ProductImportPreview) {
    const f = file.current;
    if (!f || !preview.import_token) return;
    setPhase({ name: 'saving', preview });
    setError(null);
    try {
      const result = await post<ProductImportResult>(
        '/products/import/commit',
        toFormData(f, preview.import_token),
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['products'] }),
        qc.invalidateQueries({ queryKey: ['categories'] }),
      ]);
      const total = result.created + result.updated;
      setToast(`${total} produk berhasil disimpan`);
      file.current = null;
      setPhase({ name: 'success', result });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'IMPORT_STALE') {
        setNotice('Katalog berubah, unggah ulang. Pratinjau diperbarui dengan file yang sama.');
        await runPreview(f);
        return;
      }
      setError(
        e instanceof ApiError && e.status >= 500
          ? 'Produk belum tersimpan. Terjadi gangguan, tidak ada yang berubah. Tekan Simpan untuk mencoba lagi.'
          : importErrorMessage(e),
      );
      setPhase({ name: 'preview', preview });
    }
  }

  async function downloadTemplate(format: 'xlsx' | 'csv') {
    setDownloading(format);
    setError(null);
    try {
      const { blob, filename } = await download(`/products/import/template?format=${format}`);
      saveBlob(blob, filename);
    } catch (e) {
      setError(importErrorMessage(e));
    } finally {
      setDownloading(null);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  }

  const back = () => {
    if (hasPreview) setLeaving(true);
    else void router.navigate({ to: '/produk' });
  };

  const preview = hasPreview ? phase.preview : null;
  const saving = phase.name === 'saving';
  const errCount = preview?.summary.error ?? 0;
  const activeFilter: Filter = filter ?? (errCount > 0 ? 'error' : 'all');
  const shown =
    preview?.rows.filter((r) => activeFilter === 'all' || r.action === activeFilter) ?? [];

  return (
    <>
      <p className="mb-2">
        <button type="button" className="min-h-11 font-extrabold underline" onClick={back}>
          ← Produk
        </button>
      </p>
      <PageHeader
        title="Impor produk dari file"
        subtitle="Tambah banyak produk sekaligus. Belum ada yang tersimpan sampai Anda menekan Simpan."
      />
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="warn">{notice}</Alert> : null}

      {phase.name === 'success' ? (
        <Card>
          <h2 ref={resultHeading} tabIndex={-1} className="text-lg">
            {phase.result.created + phase.result.updated} produk berhasil disimpan
          </h2>
          <p className="mt-1 text-sm">
            {phase.result.created} baru · {phase.result.updated} diperbarui ·{' '}
            {phase.result.categories_created} kategori baru dibuat
          </p>
          <p className="mt-1 text-sm text-muted">
            Produk akan muncul di aplikasi kasir setelah sinkron (±1 menit).
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to="/produk"
              className="inline-flex min-h-12 items-center rounded-full bg-pri px-5 text-[15px] font-extrabold text-pri-ink"
            >
              Lihat daftar produk
            </Link>
            <Button onClick={() => setPhase({ name: 'idle' })}>Impor file lain</Button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="mb-3">
            <h2 className="text-lg">1. Unduh template</h2>
            <p className="text-sm text-muted">
              Buka di Excel, Google Sheets, atau HP, lalu isi produk Anda.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                small
                disabled={downloading !== null}
                onClick={() => void downloadTemplate('xlsx')}
              >
                Template Excel (.xlsx)
              </Button>
              <Button
                small
                disabled={downloading !== null}
                onClick={() => void downloadTemplate('csv')}
              >
                Template CSV
              </Button>
            </div>
          </Card>

          <Card className="mb-3">
            <h2 className="text-lg">2. Unggah file yang sudah diisi</h2>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv"
              className="sr-only"
              aria-label="File impor produk"
              tabIndex={-1}
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`mt-2 rounded-2xl border-[3px] border-dashed p-5 text-center ${dragging ? 'border-pri bg-tint' : 'border-line-strong'}`}
            >
              {phase.name === 'checking' ? (
                <p role="status" className="font-bold">
                  Memeriksa file. Belum ada yang disimpan.
                </p>
              ) : (
                <>
                  <p className="font-bold">
                    {dragging
                      ? 'Lepas file di sini untuk mulai memeriksa'
                      : desktop
                        ? 'Tarik file ke sini, atau'
                        : 'Pilih file dari HP Anda'}
                  </p>
                  <div className="mt-2">
                    <Button
                      variant={hasPreview ? 'secondary' : 'primary'}
                      disabled={saving}
                      onClick={() => input.current?.click()}
                    >
                      {hasPreview ? 'Ganti file' : 'Pilih file'}
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-muted">.xlsx atau .csv · maks. 2 MB</p>
                </>
              )}
            </div>
          </Card>
        </>
      )}

      {preview ? (
        <Card>
          <h2 className="mb-2 text-lg">3. Periksa lalu simpan</h2>
          <Summary preview={preview} />
          {errCount > 0 ? (
            <Alert>
              {errCount} baris perlu diperbaiki. Tidak ada produk yang disimpan. Perbaiki file Anda,
              lalu unggah lagi.
            </Alert>
          ) : preview.import_token ? (
            <div
              role="status"
              className="mb-3 rounded-2xl bg-ok-bg px-3.5 py-2.5 text-sm font-bold text-ok-ink"
            >
              File siap disimpan. {preview.summary.create} produk baru, {preview.summary.update}{' '}
              diperbarui.
              {preview.new_categories.length > 0
                ? ` Kategori baru ${preview.new_categories.map((k) => `"${k}"`).join(', ')} akan dibuat.`
                : ''}
            </div>
          ) : (
            <div role="status" className="mb-3 rounded-2xl bg-bg px-3.5 py-2.5 text-sm font-bold">
              Tidak ada perubahan. Semua produk di file sudah sama dengan katalog Anda.
            </div>
          )}
          {preview.warnings.map((w) => (
            <Alert key={w.code} tone="warn">
              {w.message}
            </Alert>
          ))}
          <div role="group" aria-label="Filter baris" className="mb-2 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={activeFilter === f.key}
                onClick={() => setFilter(f.key)}
                className={`min-h-11 rounded-full px-4 text-sm font-extrabold ${activeFilter === f.key ? 'bg-ink text-bg' : 'bg-bg text-ink'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <PreviewRows rows={shown} />
          </div>
          <div className="sticky bottom-[76px] md:bottom-0 mt-3 bg-surface pt-2">
            {saving ? (
              <p role="status" className="mb-2 text-sm font-bold">
                Menyimpan {preview.summary.create + preview.summary.update} produk… Jangan tutup
                halaman ini.
              </p>
            ) : preview.import_token === null && errCount > 0 ? (
              <p className="mb-2 text-sm text-muted">Simpan aktif setelah semua baris benar.</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={saving || preview.import_token === null}
                onClick={() => void save(preview)}
              >
                Simpan {preview.summary.create + preview.summary.update} produk
              </Button>
              {errCount > 0 ? (
                <>
                  <Button onClick={() => input.current?.click()}>Unggah file perbaikan</Button>
                  <Button
                    onClick={() => saveBlob(errorListCsv(preview.rows), 'daftar-error-impor.csv')}
                  >
                    Daftar error (.csv)
                  </Button>
                </>
              ) : null}
              <Button disabled={saving} onClick={back}>
                Batal
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {leaving ? (
        <ConfirmDialog
          title="Batalkan impor?"
          confirmLabel="Ya, batalkan"
          onConfirm={() => {
            setLeaving(false);
            setPhase({ name: 'idle' });
            void router.navigate({ to: '/produk' });
          }}
          onClose={() => setLeaving(false)}
        >
          File ini belum disimpan. Kalau dibatalkan, Anda perlu mengunggahnya lagi.
        </ConfirmDialog>
      ) : null}
      {toast ? <Toast>{toast}</Toast> : null}
    </>
  );
}
