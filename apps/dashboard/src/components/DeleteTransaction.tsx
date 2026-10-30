import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TransactionDeletionEvent } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import {
  deletionErrorMessage,
  invalidateAfterDeletion,
  isDeletableStatus,
  reasonError,
  useIsOwner,
  type DeletableTransaction,
} from '../lib/deletion';
import { formatDateTime } from '../lib/format';
import { Alert, Button, Dialog, TextareaField } from './ui';
import { TRANSACTION_DELETE_REASON } from '@kelola-kasir/contracts';

function Summary({ tx }: { tx: DeletableTransaction }) {
  return (
    <dl className="mb-3 rounded-2xl bg-tint p-3 text-sm">
      <div className="flex justify-between gap-3">
        <dt className="text-muted">Nomor</dt>
        <dd className="font-extrabold">{tx.number}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted">Total</dt>
        <dd className="font-extrabold tabular-nums">{formatRupiah(tx.total)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted">Waktu</dt>
        <dd className="font-extrabold">{formatDateTime(tx.paid_at ?? tx.client_created_at)}</dd>
      </div>
    </dl>
  );
}

function DeleteDialog({ tx, onClose }: { tx: DeletableTransaction; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const invalid = reasonError(reason);
  const del = useMutation({
    mutationFn: () =>
      api(`/transactions/${tx.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: reason.trim() }),
      }),
    onSuccess: async () => {
      await invalidateAfterDeletion(qc);
      onClose();
    },
  });
  return (
    <Dialog title="Hapus transaksi ini?" onClose={onClose}>
      {del.error ? <Alert>{deletionErrorMessage(del.error)}</Alert> : null}
      <Summary tx={tx} />
      <p className="mb-3 text-sm text-muted">
        Transaksi tidak hilang permanen. Ia masuk ke Riwayat Hapus dan bisa dipulihkan kapan saja.
        Angka laporan dan shift yang masih terbuka ikut berkurang.
      </p>
      <TextareaField
        label="Alasan menghapus"
        placeholder="Contoh: transaksi uji coba, input dobel"
        value={reason}
        maxLength={TRANSACTION_DELETE_REASON.max + 50}
        onChange={(e) => setReason(e.target.value)}
        onBlur={() => setTouched(true)}
        error={touched ? invalid : undefined}
        hint={`${reason.trim().length}/${TRANSACTION_DELETE_REASON.max} karakter (minimal ${TRANSACTION_DELETE_REASON.min})`}
      />
      <div className="mt-2 flex gap-2">
        <Button
          variant="danger"
          disabled={Boolean(invalid) || del.isPending}
          onClick={() => del.mutate()}
        >
          {del.isPending ? 'Menghapus…' : 'Hapus transaksi'}
        </Button>
        <Button onClick={onClose}>Batal</Button>
      </div>
    </Dialog>
  );
}

function RestoreDialog({ tx, onClose }: { tx: DeletableTransaction; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const restore = useMutation({
    mutationFn: () =>
      api(`/transactions/${tx.id}/restore`, {
        method: 'POST',
        body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: async () => {
      await invalidateAfterDeletion(qc);
      onClose();
    },
  });
  return (
    <Dialog title="Pulihkan transaksi ini?" onClose={onClose}>
      {restore.error ? <Alert>{deletionErrorMessage(restore.error)}</Alert> : null}
      <Summary tx={tx} />
      <p className="mb-3 text-sm text-muted">
        Transaksi kembali masuk ke daftar, laporan, dan ringkasan seperti semula.
      </p>
      <TextareaField
        label="Catatan (opsional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="mt-2 flex gap-2">
        <Button variant="primary" disabled={restore.isPending} onClick={() => restore.mutate()}>
          {restore.isPending ? 'Memulihkan…' : 'Pulihkan'}
        </Button>
        <Button onClick={onClose}>Batal</Button>
      </div>
    </Dialog>
  );
}

/** Owner-only "Hapus transaksi" action; disabled with a hint while the transaction is still being settled. */
export function DeleteTransactionButton({ tx }: { tx: DeletableTransaction }) {
  const isOwner = useIsOwner();
  const [open, setOpen] = useState(false);
  if (!isOwner) return null;
  const deletable = isDeletableStatus(tx.status);
  return (
    <div className="mt-4">
      <Button
        variant="danger"
        disabled={!deletable}
        aria-describedby={deletable ? undefined : 'delete-hint'}
        onClick={() => setOpen(true)}
      >
        <Trash2 size={18} aria-hidden="true" />
        Hapus transaksi
      </Button>
      {deletable ? null : (
        <p id="delete-hint" className="mt-1 text-[13px] text-muted">
          Selesaikan pembayaran/void dulu
        </p>
      )}
      {open ? <DeleteDialog tx={tx} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

export function RestoreTransactionButton({ tx }: { tx: DeletableTransaction }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <Button variant="primary" onClick={() => setOpen(true)}>
        <ArchiveRestore size={18} aria-hidden="true" />
        Pulihkan
      </Button>
      {open ? <RestoreDialog tx={tx} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

export function DeletionTimeline({ events }: { events: TransactionDeletionEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section className="mt-4" aria-label="Linimasa hapus dan pulihkan">
      <h3 className="mb-1 text-base">Linimasa</h3>
      <ol className="space-y-2 border-l-2 border-line pl-3 text-sm">
        {events.map((e) => (
          <li key={e.id}>
            <b>{e.action === 'delete' ? 'Dihapus' : 'Dipulihkan'}</b> oleh {e.actor.name} ·{' '}
            {formatDateTime(e.created_at)}
            {e.reason ? <span className="block text-muted">“{e.reason}”</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
