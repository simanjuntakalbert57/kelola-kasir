import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Discount, DiscountDetail, DiscountStatus } from '@kelola-kasir/contracts';
import { Link } from '@tanstack/react-router';
import { Plus, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { ownedOutlets, useAuth } from '../auth/AuthProvider';
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
  SelectField,
  Skeleton,
  TextareaField,
} from '../components/ui';
import { api, del, patch, qs } from '../lib/api';
import {
  DISCOUNT_KEY,
  DISCOUNT_STATUS,
  discountErrorMessage,
  formatDiscountValue,
  formatPeriod,
  formatSchedule,
  targetNames,
} from '../lib/discounts';
import { formatDateTime } from '../lib/format';
import { useDebounced } from '../lib/useDebounced';

type ListResponse = {
  data: Discount[];
  outdated_devices: {
    device_id: string;
    code: string;
    name: string;
    app_version: string | null;
  }[];
};

const linkBtn =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-pri px-5 text-[15px] font-extrabold whitespace-nowrap text-pri-ink hover:bg-pri-hover';

const ACTION_LABEL = {
  create: 'Dibuat',
  update: 'Diubah',
  activate: 'Diaktifkan',
  deactivate: 'Dinonaktifkan',
  delete: 'Dihapus',
} as const;

function DeleteDialog({ discount, onClose }: { discount: Discount; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const remove = useMutation({
    mutationFn: () => del(`/discounts/${discount.id}`, { reason: reason.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: DISCOUNT_KEY });
      onClose();
    },
  });
  return (
    <ConfirmDialog
      title={`Hapus “${discount.name}”?`}
      confirmLabel="Ya, hapus"
      pending={remove.isPending || reason.trim().length < 3}
      error={remove.error ? discountErrorMessage(remove.error) : undefined}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    >
      <p className="mb-3">
        HP kasir berhenti memakai diskon ini setelah sinkron. Transaksi lama tetap menyimpan
        potongannya.
      </p>
      <TextareaField
        label="Alasan (wajib)"
        value={reason}
        maxLength={200}
        onChange={(e) => setReason(e.target.value)}
      />
    </ConfirmDialog>
  );
}

function DetailDialog({
  discount,
  canEdit,
  onClose,
  onDelete,
}: {
  discount: Discount;
  canEdit: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: [...DISCOUNT_KEY, 'detail', discount.id],
    queryFn: () => api<DiscountDetail>(`/discounts/${discount.id}`),
  });
  const d = detail.data ?? discount;
  const toggle = useMutation({
    mutationFn: () => patch(`/discounts/${d.id}`, { version: d.version, is_active: !d.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: DISCOUNT_KEY }),
    onError: () => void qc.invalidateQueries({ queryKey: DISCOUNT_KEY }),
  });
  const history = detail.data?.history ?? [];
  return (
    <Dialog title={d.name} onClose={onClose}>
      {toggle.error ? <Alert>{discountErrorMessage(toggle.error)}</Alert> : null}
      <p className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={DISCOUNT_STATUS[d.status].tone}>{DISCOUNT_STATUS[d.status].label}</Badge>
        <b>{formatDiscountValue(d)}</b>
      </p>
      <dl className="space-y-1 text-sm">
        <div>
          <dt className="inline font-extrabold">Periode: </dt>
          <dd className="inline">{formatPeriod(d)}</dd>
        </div>
        <div>
          <dt className="inline font-extrabold">Jadwal: </dt>
          <dd className="inline">{formatSchedule(d)}</dd>
        </div>
        {d.outlets.map((o) => (
          <div key={o.outlet.id}>
            <dt className="inline font-extrabold">{o.outlet.name}: </dt>
            <dd className="inline">
              {[...o.products.map((p) => p.name), ...o.categories.map((c) => c.name)].join(', ')}
            </dd>
          </div>
        ))}
      </dl>
      {canEdit ? (
        <>
          <h3 className="mt-4 mb-1 text-sm">Riwayat perubahan</h3>
          {detail.isPending ? <Skeleton rows={2} /> : null}
          <ol className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {[...history].reverse().map((h) => (
              <li key={h.id} className="rounded-xl bg-bg px-3 py-1.5">
                <b>{ACTION_LABEL[h.action]}</b> oleh {h.actor.name} · v{h.version}
                <span className="block text-[13px] text-muted">
                  {formatDateTime(h.created_at)}
                  {h.reason ? ` · “${h.reason}”` : ''}
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">
          Tampilan lihat saja. Diskon hanya bisa diubah oleh pemilik.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {canEdit && d.status !== 'deleted' ? (
          <>
            <Link to="/diskon/$id" params={{ id: d.id }} className={linkBtn}>
              Ubah
            </Link>
            <Button disabled={toggle.isPending} onClick={() => toggle.mutate()}>
              {d.is_active ? 'Nonaktifkan' : 'Aktifkan'}
            </Button>
            <Button variant="danger" onClick={onDelete}>
              Hapus
            </Button>
          </>
        ) : null}
        <Button onClick={onClose}>Tutup</Button>
      </div>
    </Dialog>
  );
}

const FILTERS: { value: '' | DiscountStatus; label: string }[] = [
  { value: '', label: 'Semua status' },
  { value: 'active', label: 'Aktif' },
  { value: 'scheduled', label: 'Terjadwal' },
  { value: 'ended', label: 'Selesai' },
  { value: 'inactive', label: 'Nonaktif' },
];

/** Menu Diskon: owner manages, a manager only sees the discounts of their own branch (ADR-0023 §6). */
export function DiscountsPage() {
  const { role, user, activeOutlet } = useAuth();
  const isOwner = role === 'owner';
  const multi = isOwner && ownedOutlets(user).length >= 2;
  const [status, setStatus] = useState<'' | DiscountStatus>('');
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim().toLowerCase());
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Discount | null>(null);
  const list = useQuery({
    queryKey: [...DISCOUNT_KEY, 'list', activeOutlet?.id, scope, status],
    queryFn: () =>
      api<ListResponse>(
        `/discounts${qs({ outlet_scope: isOwner ? scope : undefined, status: status || undefined })}`,
      ),
  });
  const rows = (list.data?.data ?? []).filter(
    (d) =>
      !q ||
      d.name.toLowerCase().includes(q) ||
      targetNames(d).some((n) => n.toLowerCase().includes(q)),
  );
  const open = rows.find((d) => d.id === openId) ?? null;
  const outdated = list.data?.outdated_devices ?? [];
  return (
    <>
      <PageHeader
        title="Diskon"
        subtitle={
          isOwner ? 'Atur promo per produk atau kategori.' : 'Lihat saja, khusus cabang ini.'
        }
        action={
          isOwner ? (
            <div className="flex flex-wrap gap-2">
              <Link
                to="/diskon/laporan"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-surface px-5 text-[15px] font-extrabold text-ink ring-2 ring-line-strong ring-inset hover:bg-bg"
              >
                Laporan promo
              </Link>
              <Link to="/diskon/baru" className={linkBtn}>
                <Plus size={18} aria-hidden="true" />
                Buat diskon
              </Link>
            </div>
          ) : (
            <Link
              to="/diskon/laporan"
              className="inline-flex min-h-12 items-center rounded-full bg-surface px-5 text-[15px] font-extrabold ring-2 ring-line-strong ring-inset"
            >
              Laporan promo
            </Link>
          )
        }
      />
      {outdated.length > 0 ? (
        <NoticeCard kind="action" title="Ada HP kasir yang belum mendukung diskon">
          <p className="flex flex-wrap items-center gap-x-2">
            <Smartphone size={16} aria-hidden="true" />
            {outdated.map((o) => `${o.name} (${o.code})`).join(', ')} — perbarui aplikasi agar promo
            berlaku di HP itu.
          </p>
        </NoticeCard>
      ) : null}
      <div className="grid gap-x-3 sm:grid-cols-3">
        <Field
          label="Cari diskon"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
        <SelectField
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as '' | DiscountStatus)}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </SelectField>
        {multi ? (
          <SelectField
            label="Cabang"
            value={scope}
            onChange={(e) => setScope(e.target.value as 'current' | 'all')}
          >
            <option value="current">{activeOutlet?.name ?? 'Cabang ini'}</option>
            <option value="all">Semua cabang</option>
          </SelectField>
        ) : null}
      </div>
      {list.isPending ? <Skeleton /> : null}
      {list.error ? (
        <ErrorState onRetry={() => void list.refetch()}>Daftar diskon belum kebuka.</ErrorState>
      ) : null}
      {list.data && rows.length === 0 ? (
        <Card>
          <EmptyState icon="🏷️" title={status || q ? 'Diskon tidak ketemu' : 'Belum ada diskon'}>
            {isOwner && !status && !q ? (
              <Link to="/diskon/baru" className={linkBtn}>
                Buat diskon pertama
              </Link>
            ) : null}
          </EmptyState>
        </Card>
      ) : null}
      <ul className="space-y-2">
        {rows.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => setOpenId(d.id)}
              className="flex w-full flex-wrap items-center gap-3 rounded-2xl bg-surface p-3 text-left shadow-card"
            >
              <span className="min-w-40 flex-1">
                <b className="block truncate">{d.name}</b>
                <span className="block truncate text-sm text-muted">
                  {targetNames(d).slice(0, 3).join(', ')}
                  {targetNames(d).length > 3 ? ` +${targetNames(d).length - 3}` : ''}
                </span>
                <span className="block text-[13px] text-muted">
                  {formatPeriod(d)} · {formatSchedule(d)}
                </span>
              </span>
              <b className="tabular-nums">{formatDiscountValue(d)}</b>
              <Badge tone={DISCOUNT_STATUS[d.status].tone}>{DISCOUNT_STATUS[d.status].label}</Badge>
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <DetailDialog
          discount={open}
          canEdit={isOwner}
          onClose={() => setOpenId(null)}
          onDelete={() => {
            setDeleting(open);
            setOpenId(null);
          }}
        />
      ) : null}
      {deleting ? <DeleteDialog discount={deleting} onClose={() => setDeleting(null)} /> : null}
    </>
  );
}
