import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OutletSettings } from '@kelola-kasir/contracts';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ImageUpload } from '../components/ImageUpload';
import { ReceiptPreview } from '../components/ReceiptPreview';
import {
  Alert,
  Button,
  Card,
  CheckboxField,
  ErrorState,
  Field,
  NoticeCard,
  PageHeader,
  Skeleton,
  TextareaField,
} from '../components/ui';
import { ThemeCard } from '../components/ThemeToggle';
import { ApiError, api, patch, post } from '../lib/api';
import { useUnsavedWarning } from '../lib/useUnsavedWarning';

const KEY = ['settings'] as const;

const schema = z
  .object({
    display_name: z
      .string()
      .trim()
      .min(1, 'Nama toko wajib diisi.')
      .max(60, 'Maksimal 60 karakter.'),
    address: z.string().max(200, 'Maksimal 200 karakter.'),
    phone: z.string().max(20, 'Maksimal 20 karakter.'),
    logo_url: z.string().nullable(),
    receipt_header: z.string().max(200, 'Maksimal 200 karakter.'),
    receipt_footer: z.string().max(200, 'Maksimal 200 karakter.'),
    qris_static_image_url: z.string().nullable(),
    qris_static_payload: z.string(),
    qris_embed_amount: z.boolean(),
  })
  .superRefine((v, ctx) => {
    // The API rejects every QRIS sale (503) when the shop has no QRIS code, so an image alone is not enough.
    if (v.qris_static_payload.trim() === '' && (v.qris_static_image_url || v.qris_embed_amount)) {
      ctx.addIssue({
        code: 'custom',
        path: ['qris_static_payload'],
        message: 'Kode QRIS wajib diisi agar kasir bisa menerima pembayaran QRIS.',
      });
    }
  });
type Form = z.infer<typeof schema>;

const toForm = (s: OutletSettings): Form => ({
  display_name: s.display_name,
  address: s.address ?? '',
  phone: s.phone ?? '',
  logo_url: s.logo_url ?? null,
  receipt_header: s.receipt_header ?? '',
  receipt_footer: s.receipt_footer ?? '',
  qris_static_image_url: s.qris_static_image_url ?? null,
  qris_static_payload: s.qris_static_payload ?? '',
  qris_embed_amount: s.qris_embed_amount ?? false,
});

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface DecodedQris {
  qris_static_payload: string;
  qris_merchant_name: string;
  is_static: boolean;
}

const FIELD_LABELS: Partial<Record<keyof Form, string>> = {
  display_name: 'Nama toko',
  address: 'Alamat',
  phone: 'Telepon',
  receipt_header: 'Header struk',
  receipt_footer: 'Footer struk',
  qris_static_payload: 'Kode QRIS',
};

const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim());

function SettingsForm({ settings }: { settings: OutletSettings }) {
  const qc = useQueryClient();
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: toForm(settings) });
  const save = useMutation({
    mutationFn: (v: Form) =>
      patch<OutletSettings>('/settings', {
        display_name: v.display_name,
        address: blankToNull(v.address),
        phone: blankToNull(v.phone),
        logo_url: v.logo_url,
        receipt_header: blankToNull(v.receipt_header),
        receipt_footer: blankToNull(v.receipt_footer),
        qris_static_image_url: v.qris_static_image_url,
        qris_static_payload: blankToNull(v.qris_static_payload),
        qris_embed_amount: v.qris_embed_amount,
      }),
    onSuccess: async (updated) => {
      qc.setQueryData(KEY, updated);
      form.reset(toForm(updated));
    },
  });
  const [decodeNote, setDecodeNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [logoNotice, setLogoNotice] = useState<string | null>(null);
  const [invalidLabels, setInvalidLabels] = useState<string[]>([]);
  const errors = form.formState.errors;
  useUnsavedWarning(form.formState.isDirty);

  /** Saves just these fields right away and marks them as clean, so an upload survives a refresh. */
  async function persist(body: Partial<Record<keyof Form, string | boolean | null>>) {
    const updated = await patch<OutletSettings>('/settings', body);
    qc.setQueryData(KEY, updated);
    const saved = toForm(updated);
    for (const key of Object.keys(body) as (keyof Form)[]) {
      form.resetField(key, { defaultValue: saved[key] });
    }
  }

  async function changeLogo(url: string | null) {
    setLogoNotice(null);
    await persist({ logo_url: url });
    setLogoNotice(url ? 'Logo tersimpan.' : 'Logo dihapus.');
  }

  async function changeQrisImage(url: string | null) {
    setDecodeNote(null);
    if (url) {
      // Not saved yet: the API rejects an image without a QRIS code, so decodeQris saves it once it has one.
      form.setValue('qris_static_image_url', url, { shouldDirty: true });
      return;
    }
    const noCode = form.getValues('qris_static_payload').trim() === '';
    await persist({
      qris_static_image_url: null,
      ...(noCode ? { qris_embed_amount: false } : {}),
    });
    setDecodeNote({ ok: true, text: 'Gambar QRIS dihapus.' });
  }

  function onInvalid(errs: typeof errors) {
    const keys = Object.keys(errs) as (keyof Form)[];
    setInvalidLabels(keys.map((k) => FIELD_LABELS[k] ?? k));
    if (keys[0]) form.setFocus(keys[0]);
  }

  /** Fills "Kode QRIS" from the uploaded image; on failure the owner is asked to type it. */
  async function decodeQris(file: File, imageUrl: string) {
    setDecodeNote(null);
    try {
      const res = await post<DecodedQris>('/settings/qris/decode', {
        image_base64: await toBase64(file),
      });
      if (!res.is_static) {
        setDecodeNote({
          ok: false,
          text: 'QRIS pada gambar ini sudah berisi nominal (dinamis). Gambar QRIS belum tersimpan. Gunakan QRIS statis toko, atau isi kode QRIS secara manual lalu tekan Simpan pengaturan.',
        });
        return;
      }
      form.setValue('qris_static_payload', res.qris_static_payload, {
        shouldDirty: true,
        shouldValidate: true,
      });
      await persist({
        qris_static_image_url: imageUrl,
        qris_static_payload: res.qris_static_payload,
      });
      setDecodeNote({
        ok: true,
        text: `Gambar & kode QRIS tersimpan (${res.qris_merchant_name}).`,
      });
    } catch (e) {
      const unreadable = e instanceof ApiError && e.code === 'INVALID_QRIS_PAYLOAD';
      setDecodeNote({
        ok: false,
        text: unreadable
          ? 'Kode QRIS tidak terbaca dari gambar. Gambar QRIS belum tersimpan. Isi kode QRIS secara manual, lalu tekan Simpan pengaturan.'
          : 'Gambar QRIS belum tersimpan. Isi kode QRIS, lalu tekan Simpan pengaturan.',
      });
    }
  }
  const [name, address, phone, header, footer, qrisPayload] = useWatch({
    control: form.control,
    name: [
      'display_name',
      'address',
      'phone',
      'receipt_header',
      'receipt_footer',
      'qris_static_payload',
    ],
  });
  const badQris = save.error instanceof ApiError && save.error.code === 'INVALID_QRIS_PAYLOAD';

  return (
    <form
      onSubmit={(e) => {
        setInvalidLabels([]);
        void form.handleSubmit((v) => save.mutateAsync(v).catch(() => undefined), onInvalid)(e);
      }}
      noValidate
      className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="space-y-4">
        {save.error ? (
          <Alert>
            {badQris
              ? 'Kode QRIS tidak valid. Periksa kembali isinya.'
              : 'Gagal menyimpan. Coba lagi ya.'}
          </Alert>
        ) : null}
        <Card>
          <h2 className="mb-3 text-lg">Toko</h2>
          <Field
            label="Nama toko"
            error={errors.display_name?.message}
            {...form.register('display_name')}
          />
          <Field label="Alamat" error={errors.address?.message} {...form.register('address')} />
          <Field
            label="Telepon"
            inputMode="tel"
            error={errors.phone?.message}
            {...form.register('phone')}
          />
          <Controller
            control={form.control}
            name="logo_url"
            render={({ field }) => (
              <ImageUpload
                label="Logo"
                purpose="logo"
                value={field.value}
                onChange={changeLogo}
                notice={logoNotice}
              />
            )}
          />
        </Card>
        <Card>
          <h2 className="mb-3 text-lg">Struk</h2>
          <TextareaField
            label="Header struk"
            hint="Baris tambahan di bawah nama & alamat, mis. akun Instagram."
            error={errors.receipt_header?.message}
            {...form.register('receipt_header')}
          />
          <TextareaField
            label="Footer struk"
            hint="Ucapan penutup, mis. “Terima kasih!”"
            error={errors.receipt_footer?.message}
            {...form.register('receipt_footer')}
          />
        </Card>
        <Card>
          <h2 className="mb-1 text-lg">QRIS statis</h2>
          <p className="mb-3 text-sm text-muted">
            Mode: statis (konfirmasi manual oleh kasir). QRIS dinamis menyusul.
          </p>
          <Controller
            control={form.control}
            name="qris_static_image_url"
            render={({ field }) => (
              <ImageUpload
                label="Gambar QRIS"
                purpose="qris_image"
                value={field.value}
                onChange={changeQrisImage}
                onUploaded={decodeQris}
                hint={
                  form.formState.dirtyFields.qris_static_image_url
                    ? 'Belum tersimpan. Isi kode QRIS lalu tekan Simpan pengaturan.'
                    : undefined
                }
              />
            )}
          />
          {decodeNote ? (
            <div role={decodeNote.ok ? 'status' : 'alert'} className="-mt-1">
              <NoticeCard kind="info">{decodeNote.text}</NoticeCard>
            </div>
          ) : null}
          <TextareaField
            label="Kode QRIS"
            hint="Terisi otomatis saat gambar QRIS diunggah; bisa juga diisi manual. Wajib bila gambar QRIS diisi; tanpa kode, kasir tidak bisa menerima QRIS."
            error={errors.qris_static_payload?.message}
            {...form.register('qris_static_payload')}
          />
          <CheckboxField
            label="Tanamkan nominal ke QRIS"
            disabled={qrisPayload.trim() === ''}
            {...form.register('qris_embed_amount')}
          />
        </Card>
        <div className="sticky bottom-20 z-[5] rounded-3xl bg-surface p-3 shadow-up md:bottom-4">
          {invalidLabels.length > 0 ? (
            <Alert>Ada isian yang perlu diperbaiki: {invalidLabels.join(', ')}.</Alert>
          ) : null}
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              className="flex-1 sm:flex-none"
              disabled={save.isPending}
            >
              Simpan pengaturan
            </Button>
            {save.isSuccess && !form.formState.isDirty ? (
              <p
                role="status"
                className="flex items-center gap-1 text-sm font-extrabold text-ok-ink"
              >
                <Check size={18} aria-hidden="true" />
                Tersimpan
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <aside aria-label="Pratinjau struk" className="lg:sticky lg:top-4 lg:self-start">
        <h2 className="mb-2 text-lg">Pratinjau struk</h2>
        <ReceiptPreview
          name={name}
          address={address}
          phone={phone}
          header={header}
          footer={footer}
        />
      </aside>
    </form>
  );
}

export function SettingsPage() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: KEY,
    queryFn: () => api<OutletSettings>('/settings'),
  });
  return (
    <>
      <PageHeader title="Pengaturan toko" subtitle="Tampil di struk dan aplikasi kasir" />
      {isPending ? <Skeleton /> : null}
      {error ? (
        <ErrorState
          title="Waduh, pengaturannya belum kebuka. Coba lagi ya"
          onRetry={() => void refetch()}
        />
      ) : null}
      <div className="mb-4">
        <ThemeCard />
      </div>
      {data ? <SettingsForm settings={data} /> : null}
    </>
  );
}
