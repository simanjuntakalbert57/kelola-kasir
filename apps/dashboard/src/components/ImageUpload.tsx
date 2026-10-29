import { useId, useState } from 'react';
import { uploadImage, type UploadPurpose } from '../lib/upload';
import { Button } from './ui';

/** Uploads an image via the presigned flow and reports the resulting public URL. */
export function ImageUpload({
  label,
  purpose,
  value,
  onChange,
  onUploaded,
}: {
  label: string;
  purpose: UploadPurpose;
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  /** Called with the picked file after it was uploaded, e.g. to read data out of the image. */
  onUploaded?: (file: File) => void | Promise<void>;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadImage(file, purpose));
      await onUploaded?.(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengunggah gambar.');
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
            className="size-16 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="grid size-16 shrink-0 place-items-center rounded-xl bg-tint text-2xl"
          >
            🖼️
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1.5">
          <input
            id={id}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            className="text-sm"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {value ? (
            <Button small onClick={() => onChange(null)} aria-label={`Hapus ${label}`}>
              Hapus
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mt-1 text-[13px] text-muted">JPG, PNG, atau WebP, maksimal 2 MB.</p>
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
