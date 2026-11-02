import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { uploadImage, type UploadPurpose } from '../lib/upload';
import { Button } from './ui';

/** Uploads an image via the presigned flow and reports the resulting public URL. */
export function ImageUpload({
  label,
  purpose,
  value,
  onChange,
  onUploaded,
  hint,
  notice,
}: {
  label: string;
  purpose: UploadPurpose;
  value: string | null | undefined;
  /** May persist the change; a rejection is shown under the picker. */
  onChange: (url: string | null) => void | Promise<void>;
  /** Called with the picked file after it was uploaded, e.g. to read data out of the image. */
  onUploaded?: (file: File, url: string) => void | Promise<void>;
  /** Shown under the preview, e.g. to tell that the image is not saved yet. */
  hint?: string | undefined;
  /** Confirmation shown after the image was saved. */
  notice?: string | null | undefined;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const url = await uploadImage(file, purpose);
      await onChange(url);
      await onUploaded?.(file, url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengunggah gambar.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await onChange(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menghapus gambar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3.5">
      <label htmlFor={id} className="mb-1 block text-sm font-extrabold">
        {label}
      </label>
      <div className="flex items-center gap-3">
        {value ? (
          <img
            src={value}
            alt={`Pratinjau ${label}`}
            className="size-20 shrink-0 rounded-2xl border border-line object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="grid size-20 shrink-0 place-items-center rounded-2xl border-2 border-dashed border-line bg-tint text-muted"
          >
            <ImagePlus size={28} />
          </div>
        )}
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button small variant="primary" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload size={16} aria-hidden="true" />
            {value ? 'Ganti gambar' : 'Pilih gambar'}
          </Button>
          {value ? (
            <Button
              small
              disabled={busy}
              onClick={() => void remove()}
              aria-label={`Hapus ${label}`}
            >
              <Trash2 size={16} aria-hidden="true" />
              Hapus
            </Button>
          ) : (
            <p className="text-[13px] text-muted">Belum ada gambar dipilih.</p>
          )}
        </div>
      </div>
      <p className="mt-1 text-[13px] text-muted">JPG, PNG, atau WebP, maksimal 2 MB.</p>
      {hint ? <p className="mt-1 text-[13px] font-bold text-muted">{hint}</p> : null}
      {notice && !busy && !error ? (
        <p role="status" className="mt-1 text-[13px] font-bold text-ok-ink">
          {notice}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="mt-1 text-[13px] text-muted">
          Mengunggah…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
