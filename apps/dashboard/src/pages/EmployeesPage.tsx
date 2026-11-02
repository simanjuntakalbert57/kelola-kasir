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
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  NoticeCard,
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

const shortDate = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Jakarta',
});

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
          hint="PIN tidak bisa dilihat lagi setelah disimpan."
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
    <Dialog title={`Atur ulang PIN ${employee.name}`} onClose={onClose}>
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
          hint="PIN tidak bisa dilihat lagi setelah disimpan."
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
  onDeactivate,
}: {
  employee: Employee;
  onReset: (e: Employee) => void;
  onDeactivate: (e: Employee) => void;
}) {
  const qc = useQueryClient();
  const activate = useMutation({
    mutationFn: () => patch<Employee>(`/employees/${employee.id}`, { is_active: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface p-3 shadow-card">
      <div
        aria-hidden="true"
        className="grid size-11 shrink-0 place-items-center rounded-full bg-tint text-lg font-black text-tint-ink"
      >
        {employee.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-40 flex-1">
        <p className="truncate font-extrabold">{employee.name}</p>
        <p className="text-sm text-muted">
          Kasir
          {employee.created_at
            ? ` · dibuat ${shortDate.format(new Date(employee.created_at))}`
            : ''}
        </p>
        {activate.error ? (
          <p role="alert" className="mt-1 text-[13px] text-danger">
            {errorMessage(activate.error)}
          </p>
        ) : null}
      </div>
      <Badge tone={employee.is_active ? 'ok' : 'off'}>
        {employee.is_active ? 'Aktif' : 'Nonaktif'}
      </Badge>
      <div className="flex w-full gap-2 sm:w-auto">
        <Button
          small
          className="flex-1 sm:flex-none"
          onClick={() => onReset(employee)}
          aria-label={`Atur ulang PIN ${employee.name}`}
        >
          Atur ulang PIN
        </Button>
        {employee.is_active ? (
          <Button
            small
            variant="danger"
            className="flex-1 sm:flex-none"
            onClick={() => onDeactivate(employee)}
            aria-label={`Nonaktifkan ${employee.name}`}
          >
            Nonaktifkan
          </Button>
        ) : (
          <Button
            small
            className="flex-1 sm:flex-none"
            disabled={activate.isPending}
            onClick={() => activate.mutate()}
            aria-label={`Aktifkan ${employee.name}`}
          >
            Aktifkan
          </Button>
        )}
      </div>
    </li>
  );
}

function DeactivateDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const qc = useQueryClient();
  const deactivate = useMutation({
    mutationFn: () => patch<Employee>(`/employees/${employee.id}`, { is_active: false }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEY });
      onClose();
    },
  });
  return (
    <ConfirmDialog
      title={`Nonaktifkan ${employee.name}?`}
      confirmLabel="Ya, nonaktifkan"
      pending={deactivate.isPending}
      error={deactivate.error ? errorMessage(deactivate.error) : undefined}
      onConfirm={() => deactivate.mutate()}
      onClose={onClose}
    >
      {employee.name} tidak bisa masuk ke aplikasi kasir lagi.
    </ConfirmDialog>
  );
}

export function EmployeesPage() {
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<Employee | null>(null);
  const [deactivating, setDeactivating] = useState<Employee | null>(null);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: KEY,
    queryFn: () => api<{ data: Employee[] }>('/employees'),
  });

  return (
    <>
      <PageHeader
        title="Pegawai"
        subtitle={data ? `${data.data.length} pegawai` : undefined}
        action={
          data && data.data.length > 0 ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              ＋ Tambah pegawai
            </Button>
          ) : undefined
        }
      />
      {isPending ? <Skeleton /> : null}
      {error ? (
        <ErrorState
          title="Waduh, daftar pegawainya belum kebuka. Coba lagi ya"
          onRetry={() => void refetch()}
        />
      ) : null}
      {data && data.data.length === 0 ? (
        <Card>
          <EmptyState icon="🧑‍🍳" title="Belum ada pegawai">
            <p>Tambah pegawai supaya kasir bisa dipakai.</p>
            <Button variant="primary" onClick={() => setCreating(true)}>
              Tambah pegawai
            </Button>
          </EmptyState>
        </Card>
      ) : null}
      {data && data.data.length > 0 ? (
        <>
          <ul className="space-y-2">
            {data.data.map((e) => (
              <EmployeeRow
                key={e.id}
                employee={e}
                onReset={setResetting}
                onDeactivate={setDeactivating}
              />
            ))}
          </ul>
          <div className="mt-4">
            <NoticeCard>
              PIN tidak bisa dilihat lagi. Kalau pegawai lupa, atur ulang PIN-nya.
            </NoticeCard>
          </div>
        </>
      ) : null}
      {creating ? <CreateEmployeeDialog onClose={() => setCreating(false)} /> : null}
      {resetting ? (
        <ResetPinDialog employee={resetting} onClose={() => setResetting(null)} />
      ) : null}
      {deactivating ? (
        <DeactivateDialog employee={deactivating} onClose={() => setDeactivating(null)} />
      ) : null}
    </>
  );
}
