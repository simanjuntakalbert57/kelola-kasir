import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OutletSettings } from '@kelola-kasir/contracts';
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
  Field,
  PageHeader,
  Skeleton,
  TextareaField,
} from '../components/ui';
import { ApiError, api, patch, post } from '../lib/api';
import { errorMessage } from '../lib/format';

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
  const errors = form.formState.errors;

  /** Fills "Kode QRIS" from the uploaded image; on failure the owner is asked to type it. */
  async function decodeQris(file: File) {
    setDecodeNote(null);
    try {
      const res = await post<DecodedQris>('/settings/qris/decode', {
        image_base64: await toBase64(file),
      });
      if (!res.is_static) {
        setDecodeNote({
          ok: false,
          text: 'QRIS pada gambar ini sudah berisi nominal (dinamis). Gunakan QRIS statis toko, atau isi kode QRIS secara manual.',
        });
        return;
      }
      form.setValue('qris_static_payload', res.qris_static_payload, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setDecodeNote({
        ok: true,
        text: `Kode QRIS terisi otomatis dari gambar (${res.qris_merchant_name}).`,
      });
    } catch (e) {
      const unreadable = e instanceof ApiError && e.code === 'INVALID_QRIS_PAYLOAD';
      setDecodeNote({
        ok: false,
        text: unreadable
          ? 'Kode QRIS tidak terbaca dari gambar. Isi kode QRIS secara manual, atau unggah gambar yang lebih jelas (PNG/JPG).'
          : 'Gambar tersimpan, tetapi kode QRIS belum bisa dibaca otomatis. Isi kode QRIS secara manual.',
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
      onSubmit={(e) => void form.handleSubmit((v) => save.mutateAsync(v).catch(() => undefined))(e)}
      noValidate
      className="grid gap-4 lg:grid-cols-[1fr_20rem]"
    >
      <div className="space-y-4">
        {save.error ? (
          <Alert>
            {badQris ? 'Kode QRIS tidak valid. Periksa kembali isinya.' : errorMessage(save.error)}
          </Alert>
        ) : null}
        {save.isSuccess && !form.formState.isDirty ? (
          <p
            role="status"
            className="rounded-[12px] bg-brand-tint px-3.5 py-2 text-sm font-semibold text-brand-text"
          >
            Pengaturan tersimpan.
          </p>
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
                onChange={field.onChange}
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
                onChange={field.onChange}
                onUploaded={decodeQris}
              />
            )}
          />
          {decodeNote ? (
            <p
              role={decodeNote.ok ? 'status' : 'alert'}
              className={`-mt-2 mb-3 text-[13px] ${decodeNote.ok ? 'text-brand-text' : 'text-danger'}`}
            >
              {decodeNote.text}
            </p>
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
        <Button type="submit" variant="primary" disabled={save.isPending}>
          Simpan perubahan
        </Button>
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
      <PageHeader title="Pengaturan toko" />
      {isPending ? <Skeleton /> : null}
      {error ? (
        <Alert>
          Gagal memuat pengaturan.{' '}
          <button type="button" className="underline" onClick={() => void refetch()}>
            Coba lagi
          </button>
        </Alert>
      ) : null}
      {data ? <SettingsForm settings={data} /> : null}
    </>
  );
}
