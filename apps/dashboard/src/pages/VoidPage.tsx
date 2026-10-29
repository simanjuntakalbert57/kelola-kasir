import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { VoidRequest } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  TextareaField,
} from '../components/ui';
import { ApiError, api, post, qs } from '../lib/api';
import { errorMessage, formatDateTime } from '../lib/format';

type Decision = { request: VoidRequest; action: 'approve' | 'reject' };
type Page = { data: VoidRequest[]; next_cursor: string | null };
type Tab = 'pending' | 'approved' | 'rejected';

const TABS: { id: Tab; label: string }[] = [
  { id: 'pending', label: 'Menunggu' },
  { id: 'approved', label: 'Disetujui' },
  { id: 'rejected', label: 'Ditolak' },
];

function DecisionDialog({ request, action, onClose }: Decision & { onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const approve = action === 'approve';
  const mutation = useMutation({
    mutationFn: () =>
      post<VoidRequest>(
        `/void-requests/${request.id}/${action}`,
        note.trim() ? { note: note.trim() } : {},
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['void-requests'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
  });
  const conflict = mutation.error instanceof ApiError && mutation.error.status === 409;
  return (
    <Dialog
      title={`${[approve ? 'Setujui' : 'Tolak', 'batal', request.transaction_number]
        .filter(Boolean)
        .join(' ')}?`}
      onClose={onClose}
    >
      {mutation.error ? (
        <Alert>
          {conflict
            ? 'Permintaan ini sudah diproses atau transaksinya tidak bisa dibatalkan lagi.'
            : errorMessage(mutation.error)}
        </Alert>
      ) : null}
      <p className="mb-3 text-sm text-muted">
        {approve
          ? 'Transaksi akan dibatalkan dan keluar dari omzet. Tindakan ini tercatat.'
          : 'Transaksi tetap lunas.'}
      </p>
      <TextareaField
        label="Catatan (opsional)"
        maxLength={300}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="mt-2 flex gap-2">
        <Button
          variant={approve ? 'danger' : 'primary'}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {approve ? 'Ya, setujui batal' : 'Ya, tolak'}
        </Button>
        <Button onClick={onClose}>Batal</Button>
      </div>
    </Dialog>
  );
}

export function VoidPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [decision, setDecision] = useState<Decision | null>(null);
  const { data, isPending, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['void-requests', tab],
      initialPageParam: '',
      queryFn: ({ pageParam }) =>
        api<Page>(`/void-requests${qs({ status: tab, cursor: pageParam })}`),
      getNextPageParam: (last) => last.next_cursor ?? undefined,
    });
  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <>
      <PageHeader
        title="Persetujuan batal"
        subtitle={
          tab === 'pending' && rows.length > 0
            ? `${rows.length}${hasNextPage ? '+' : ''} permintaan nunggu Bapak`
            : undefined
        }
      />
      <div role="tablist" aria-label="Status batal" className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-h-11 rounded-full px-4 text-sm font-extrabold ring-1 ring-line ${tab === t.id ? 'bg-pri text-pri-ink' : 'bg-surface text-muted'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {isPending ? <Skeleton /> : null}
      {error ? (
        <ErrorState
          title="Waduh, permintaannya belum kebuka. Coba lagi ya"
          onRetry={() => void refetch()}
        />
      ) : null}
      {data && rows.length === 0 ? (
        <Card>
          {tab === 'pending' ? (
            <EmptyState icon="✅" title="Semua beres, Pak.">
              <p>Belum ada permintaan batal yang nunggu persetujuan.</p>
            </EmptyState>
          ) : (
            <EmptyState icon="✅" title="Belum ada permintaan">
              <p>Belum ada permintaan batal yang {tab === 'approved' ? 'disetujui' : 'ditolak'}.</p>
            </EmptyState>
          )}
        </Card>
      ) : null}
      {data && rows.length > 0 ? (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <b className="min-w-0 break-all">{r.transaction_number ?? 'Transaksi'}</b>
                  <Badge
                    tone={r.status === 'pending' ? 'info' : r.status === 'approved' ? 'ok' : 'off'}
                  >
                    {r.status === 'pending'
                      ? 'Nunggu Bapak'
                      : r.status === 'approved'
                        ? 'Disetujui'
                        : 'Ditolak'}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted">
                  Diajukan {r.requested_by.name} · {formatDateTime(r.requested_at)}
                </p>
                <p className="mt-2 text-sm">
                  <span className="text-muted">Alasan</span> “{r.reason}”
                </p>
                {r.transaction_total != null ? (
                  <p className="mt-1 text-sm">
                    <span className="text-muted">Total</span>{' '}
                    <b className="tabular-nums">{formatRupiah(r.transaction_total)}</b>
                  </p>
                ) : null}
                {r.decision_note ? (
                  <p className="mt-1 text-sm text-muted">Catatan: {r.decision_note}</p>
                ) : null}
                {r.status === 'pending' ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="primary"
                      className="flex-1"
                      aria-label={`Setujui batal ${r.transaction_number ?? ''}`}
                      onClick={() => setDecision({ request: r, action: 'approve' })}
                    >
                      Setujui
                    </Button>
                    <Button
                      className="flex-1"
                      aria-label={`Tolak batal ${r.transaction_number ?? ''}`}
                      onClick={() => setDecision({ request: r, action: 'reject' })}
                    >
                      Tolak
                    </Button>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
      {data && rows.length > 0 ? (
        <div className="mt-3 flex items-center justify-between text-sm text-muted">
          <span>Menampilkan {rows.length} permintaan</span>
          {hasNextPage ? (
            <Button small disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
              Muat lebih banyak
            </Button>
          ) : null}
        </div>
      ) : null}
      {decision ? <DecisionDialog {...decision} onClose={() => setDecision(null)} /> : null}
    </>
  );
}
