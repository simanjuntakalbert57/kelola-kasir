import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Device, ResponseBody } from '@kelola-kasir/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Smartphone } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  NoticeCard,
  PageHeader,
  Skeleton,
} from '../components/ui';
import { api, post } from '../lib/api';
import { errorMessage, formatDateTime } from '../lib/format';

const KEY = ['devices'] as const;
const schema = z.object({
  name: z.string().trim().min(1, 'Nama perangkat wajib diisi.').max(60, 'Maksimal 60 karakter.'),
});

type Created = ResponseBody<'/devices', 'post', 201>;

const STATUS = {
  pending_pairing: { tone: 'info', label: 'Menunggu pairing' },
  active: { tone: 'ok', label: 'Terhubung' },
  revoked: { tone: 'off', label: 'Dicabut' },
} as const;

function CreateDeviceDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const create = useMutation({
    mutationFn: (v: z.infer<typeof schema>) => post<Created>('/devices', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const created = create.data;
  return (
    <Dialog title={created ? 'Kode pairing' : 'Tambah perangkat'} onClose={onClose}>
      {created ? (
        <div>
          <p className="text-sm text-muted">
            Masukkan kode ini di aplikasi kasir untuk “{created.device.name}”. Berlaku sekali pakai.
            Ini bukan PIN pegawai.
          </p>
          <p className="my-3 rounded-2xl bg-bg py-4 text-center font-mono text-[34px] font-black tracking-[0.2em] select-all">
            {created.pairing_code}
          </p>
          <p className="text-[13px] text-muted">
            Berlaku sampai {formatDateTime(created.pairing_expires_at)}. Kode hanya tampil sekali.
          </p>
          <Button variant="primary" className="mt-3" onClick={onClose}>
            Selesai
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) =>
            void form.handleSubmit((v) =>
              create.mutateAsync(v).then(
                () => undefined,
                () => undefined,
              ),
            )(e)
          }
          noValidate
        >
          {create.error ? <Alert>{errorMessage(create.error)}</Alert> : null}
          <Field
            label="Nama perangkat"
            placeholder="Tablet Kasir Depan"
            autoComplete="off"
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <div className="mt-3 flex gap-2">
            <Button type="submit" variant="primary" disabled={create.isPending}>
              Buat kode pairing
            </Button>
            <Button onClick={onClose}>Batal</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function RevokeDialog({ device, onClose }: { device: Device; onClose: () => void }) {
  const qc = useQueryClient();
  const revoke = useMutation({
    mutationFn: () => post<Device>(`/devices/${device.id}/revoke`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEY });
      onClose();
    },
  });
  return (
    <ConfirmDialog
      title={`Cabut ${device.name}?`}
      confirmLabel="Ya, cabut"
      pending={revoke.isPending}
      error={revoke.error ? errorMessage(revoke.error) : undefined}
      onConfirm={() => revoke.mutate()}
      onClose={onClose}
    >
      Perangkat ini langsung tidak bisa dipakai kasir. Semua sesi pegawai di perangkat ini berakhir.
    </ConfirmDialog>
  );
}

export function DevicesPage() {
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Device | null>(null);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: KEY,
    queryFn: () => api<{ data: Device[] }>('/devices'),
  });

  return (
    <>
      <PageHeader
        title="Perangkat"
        subtitle="Tablet/HP yang boleh dipakai sebagai kasir"
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            ＋ Tambah perangkat
          </Button>
        }
      />
      {isPending ? <Skeleton /> : null}
      {error ? (
        <ErrorState
          title="Waduh, daftar perangkatnya belum kebuka. Coba lagi ya"
          onRetry={() => void refetch()}
        />
      ) : null}
      {data && data.data.length === 0 ? (
        <Card>
          <EmptyState icon="📱" title="Belum ada perangkat">
            <p>Tambah satu supaya kasir bisa tersambung.</p>
            <Button variant="primary" onClick={() => setCreating(true)}>
              Tambah perangkat
            </Button>
          </EmptyState>
        </Card>
      ) : null}
      {data && data.data.length > 0 ? (
        <ul className="space-y-2">
          {data.data.map((d) => {
            const s = STATUS[d.status];
            return (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface p-3 shadow-card"
              >
                <span
                  aria-hidden="true"
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-tint text-tint-ink"
                >
                  <Smartphone size={22} />
                </span>
                <div className="min-w-40 flex-1">
                  <p className="truncate font-extrabold">
                    {d.name} <span className="font-semibold text-muted">· {d.code}</span>
                  </p>
                  <p className="text-[13px] text-muted">
                    {d.status === 'pending_pairing'
                      ? 'Kode pairing belum dipakai'
                      : `Terakhir aktif ${formatDateTime(d.last_seen_at)}`}
                    {d.app_version ? ` · v${d.app_version}` : ''}
                  </p>
                </div>
                <Badge tone={s.tone}>{s.label}</Badge>
                {d.status !== 'revoked' ? (
                  <Button
                    small
                    variant="danger"
                    onClick={() => setRevoking(d)}
                    aria-label={`Cabut ${d.name}`}
                  >
                    Cabut
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {data && data.data.length > 0 ? (
        <div className="mt-4">
          <NoticeCard>Ketuk Cabut kalau perangkat hilang atau tidak dipakai lagi.</NoticeCard>
        </div>
      ) : null}
      {creating ? <CreateDeviceDialog onClose={() => setCreating(false)} /> : null}
      {revoking ? <RevokeDialog device={revoking} onClose={() => setRevoking(null)} /> : null}
    </>
  );
}
