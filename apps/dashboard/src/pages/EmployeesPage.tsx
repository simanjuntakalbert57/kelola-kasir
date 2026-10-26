import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Employee } from '@kelola-kasir/contracts';
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
import { ApiError, api, patch, post } from '../lib/api';
import { errorMessage } from '../lib/format';

const KEY = ['employees'] as const;
const pinSchema = z.string().regex(/^[0-9]{6}$/, 'PIN harus 6 digit angka.');
const createSchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi.').max(60, 'Maksimal 60 karakter.'),
  pin: pinSchema,
});
const resetSchema = z.object({ pin: pinSchema });

function pinError(e: unknown): string {
  if (e instanceof ApiError && e.code === 'PIN_NOT_UNIQUE') {
    return 'PIN sudah dipakai pegawai lain. Pilih PIN berbeda.';
  }
  return errorMessage(e);
}

function CreateEmployeeDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof createSchema>>({ resolver: zodResolver(createSchema) });
  const create = useMutation({
    mutationFn: (v: z.infer<typeof createSchema>) => post<Employee>('/employees', v),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEY });
      onClose();
    },
  });
  return (
    <Dialog title="Tambah pegawai" onClose={onClose}>
      <form
        onSubmit={(e) =>
          void form.handleSubmit((v) => create.mutateAsync(v).catch(() => undefined))(e)
        }
        noValidate
      >
        {create.error ? <Alert>{pinError(create.error)}</Alert> : null}
        <Field
          label="Nama"
          autoComplete="off"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <Field
          label="PIN (6 digit)"
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoComplete="new-password"
          hint="PIN tidak pernah ditampilkan kembali."
          error={form.formState.errors.pin?.message}
          {...form.register('pin')}
        />
        <div className="mt-3 flex gap-2">
          <Button type="submit" variant="primary" disabled={create.isPending}>
            Simpan
          </Button>
          <Button onClick={onClose}>Batal</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ResetPinDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });
  const reset = useMutation({
    mutationFn: (v: z.infer<typeof resetSchema>) => post(`/employees/${employee.id}/reset-pin`, v),
    onSuccess: onClose,
  });
  return (
    <Dialog title={`Atur PIN — ${employee.name}`} onClose={onClose}>
      <form
        onSubmit={(e) =>
          void form.handleSubmit((v) => reset.mutateAsync(v).catch(() => undefined))(e)
        }
        noValidate
      >
        {reset.error ? <Alert>{pinError(reset.error)}</Alert> : null}
        <Field
          label="PIN baru (6 digit)"
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoComplete="new-password"
          hint="PIN tidak pernah ditampilkan kembali."
          error={form.formState.errors.pin?.message}
          {...form.register('pin')}
        />
        <div className="mt-3 flex gap-2">
          <Button type="submit" variant="primary" disabled={reset.isPending}>
            Simpan PIN
          </Button>
          <Button onClick={onClose}>Batal</Button>
        </div>
      </form>
    </Dialog>
  );
}

function EmployeeRow({
  employee,
  onReset,
}: {
  employee: Employee;
  onReset: (e: Employee) => void;
}) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      patch<Employee>(`/employees/${employee.id}`, { is_active: !employee.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-[16px] bg-surface p-3 shadow-card">
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">{employee.name}</p>
        <Badge tone={employee.is_active ? 'ok' : 'off'}>
          {employee.is_active ? 'Aktif' : 'Nonaktif'}
        </Badge>
        {toggle.error ? (
          <p role="alert" className="mt-1 text-[13px] text-danger">
            {errorMessage(toggle.error)}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        {employee.is_active ? (
          <>
            <Button
              small
              onClick={() => onReset(employee)}
              aria-label={`Atur ulang PIN ${employee.name}`}
            >
              Atur ulang PIN
            </Button>
            <Button
              small
              variant="danger"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate()}
              aria-label={`Nonaktifkan ${employee.name}`}
            >
              Nonaktifkan
            </Button>
          </>
        ) : (
          <Button
            small
            disabled={toggle.isPending}
            onClick={() => toggle.mutate()}
            aria-label={`Aktifkan ${employee.name}`}
          >
            Aktifkan
          </Button>
        )}
      </div>
    </li>
  );
}

export function EmployeesPage() {
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<Employee | null>(null);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: KEY,
    queryFn: () => api<{ data: Employee[] }>('/employees'),
  });

  return (
    <>
      <PageHeader
        title="Pegawai"
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            ＋ Tambah pegawai
          </Button>
        }
      />
      {isPending ? <Skeleton /> : null}
      {error ? (
        <Alert>
          Gagal memuat pegawai.{' '}
          <button type="button" className="underline" onClick={() => void refetch()}>
            Coba lagi
          </button>
        </Alert>
      ) : null}
      {data && data.data.length === 0 ? (
        <Card>
          <EmptyState icon="🧑‍🍳" title="Belum ada pegawai">
            <p>Tambahkan pegawai agar bisa masuk dengan PIN di kasir.</p>
          </EmptyState>
        </Card>
      ) : null}
      {data && data.data.length > 0 ? (
        <ul className="space-y-2">
          {data.data.map((e) => (
            <EmployeeRow key={e.id} employee={e} onReset={setResetting} />
          ))}
        </ul>
      ) : null}
      {creating ? <CreateEmployeeDialog onClose={() => setCreating(false)} /> : null}
      {resetting ? (
        <ResetPinDialog employee={resetting} onClose={() => setResetting(null)} />
      ) : null}
    </>
  );
}
