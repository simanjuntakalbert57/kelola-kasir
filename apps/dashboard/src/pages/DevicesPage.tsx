import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Device, ResponseBody } from '@kelola-kasir/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
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
  pending_pairing: { tone: 'warn', label: 'Menunggu pairing' },
  active: { tone: 'ok', label: 'Aktif' },
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
            Masukkan kode ini di aplikasi kasir untuk “{created.device.name}”.
          </p>
          <p className="my-3 rounded-[16px] bg-bg py-4 text-center font-mono text-3xl font-extrabold tracking-[0.3em] select-all">
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
    <Dialog title={`Cabut ${device.name}?`} onClose={onClose}>
      {revoke.error ? <Alert>{errorMessage(revoke.error)}</Alert> : null}
      <p className="text-sm text-muted">
        Semua sesi pegawai di perangkat ini langsung berakhir dan perangkat tidak bisa dipakai lagi.
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="danger" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
          Cabut perangkat
        </Button>
        <Button onClick={onClose}>Batal</Button>
      </div>
    </Dialog>
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
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            ＋ Tambah perangkat
          </Button>
        }
      />
      {isPending ? <Skeleton /> : null}
      {error ? (
        <Alert>
          Gagal memuat perangkat.{' '}
          <button type="button" className="underline" onClick={() => void refetch()}>
            Coba lagi
          </button>
        </Alert>
      ) : null}
      {data && data.data.length === 0 ? (
        <Card>
          <EmptyState icon="📱" title="Belum ada perangkat">
            <p>Buat kode pairing untuk menyambungkan HP kasir.</p>
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
                className="flex flex-wrap items-center gap-3 rounded-[16px] bg-surface p-3 shadow-card"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">
                    {d.name} <span className="font-normal text-muted">· {d.code}</span>
                  </p>
                  <Badge tone={s.tone}>{s.label}</Badge>
                  <p className="mt-1 text-[13px] text-muted">
                    Terakhir aktif: {formatDateTime(d.last_seen_at)}
                    {d.app_version ? ` · v${d.app_version}` : ''}
                  </p>
                </div>
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
      {creating ? <CreateDeviceDialog onClose={() => setCreating(false)} /> : null}
      {revoking ? <RevokeDialog device={revoking} onClose={() => setRevoking(null)} /> : null}
    </>
  );
}
