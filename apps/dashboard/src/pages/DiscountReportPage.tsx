import { useMutation, useQuery } from '@tanstack/react-query';
import type { DiscountSalesReport } from '@kelola-kasir/contracts';
import { formatRupiah } from '@kelola-kasir/money';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ownedOutlets, useAuth } from '../auth/AuthProvider';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  SelectField,
  Skeleton,
} from '../components/ui';
import { api, download, qs } from '../lib/api';
import { addDays, wibDate } from '../lib/dates';
import { formatDiscountValue } from '../lib/discounts';
import { errorMessage } from '../lib/format';

/** Sales per promo in a period, with Excel export (ADR-0023 §5). */
export function DiscountReportPage() {
  const { role, user, activeOutlet } = useAuth();
  const multi = role === 'owner' && ownedOutlets(user).length >= 2;
  const today = wibDate();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const valid = from !== '' && to !== '' && from <= to;
  const params = { date_from: from, date_to: to, outlet_scope: multi ? scope : undefined };
  const report = useQuery({
    queryKey: ['reports', 'discounts', activeOutlet?.id, scope, from, to],
    queryFn: () => api<DiscountSalesReport>(`/reports/discounts${qs(params)}`),
    enabled: valid,
  });
  const exportXlsx = useMutation({
    mutationFn: async () => {
      const { blob, filename } = await download(
        `/reports/discounts/export${qs({ ...params, format: 'xlsx' })}`,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.includes('.') ? filename : `${filename}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const rows = report.data?.data ?? [];
  return (
    <>
      <PageHeader
        title="Laporan promo"
        subtitle="Berapa diskon yang terpakai per promo."
        action={
          <Button
            disabled={!valid || exportXlsx.isPending || rows.length === 0}
            onClick={() => exportXlsx.mutate()}
          >
            {exportXlsx.isPending ? 'Menyiapkan…' : 'Ekspor Excel'}
          </Button>
        }
      />
      <p className="mb-2 text-sm">
        <Link to="/diskon" className="font-extrabold underline">
          ← Kembali ke Diskon
        </Link>
      </p>
      {exportXlsx.error ? <Alert>{errorMessage(exportXlsx.error)}</Alert> : null}
      <div className="grid gap-x-3 sm:grid-cols-3">
        <Field label="Dari" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field
          label="Sampai"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          error={from && to && from > to ? 'Tanggal akhir sebelum tanggal awal.' : undefined}
        />
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
      {report.isPending && valid ? <Skeleton /> : null}
      {report.error ? (
        <ErrorState onRetry={() => void report.refetch()}>Laporan belum kebuka.</ErrorState>
      ) : null}
      {report.data ? (
        <>
          <section aria-label="Ringkasan" className="mb-3 grid grid-cols-3 gap-2 text-center">
            <Card>
              <small className="text-muted">Omzet kotor</small>
              <b className="block tabular-nums">{formatRupiah(report.data.totals.sales_gross)}</b>
            </Card>
            <Card>
              <small className="text-muted">Diskon</small>
              <b className="block tabular-nums">
                −{formatRupiah(report.data.totals.sales_discount_total)}
              </b>
            </Card>
            <Card>
              <small className="text-muted">Omzet bersih</small>
              <b className="block tabular-nums">
                {formatRupiah(
                  report.data.totals.sales_gross - report.data.totals.sales_discount_total,
                )}
              </b>
            </Card>
          </section>
          {rows.length === 0 ? (
            <Card>
              <EmptyState icon="🏷️" title="Belum ada promo yang terpakai di periode ini" />
            </Card>
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm tabular-nums">
                <thead className="text-muted">
                  <tr>
                    <th scope="col" className="py-1 pr-3">
                      Promo
                    </th>
                    <th scope="col" className="px-3 py-1 text-right">
                      Transaksi
                    </th>
                    <th scope="col" className="px-3 py-1 text-right">
                      Cup
                    </th>
                    <th scope="col" className="px-3 py-1 text-right">
                      Kotor
                    </th>
                    <th scope="col" className="px-3 py-1 text-right">
                      Diskon
                    </th>
                    <th scope="col" className="py-1 pl-3 text-right">
                      Bersih
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.discount_id} className="border-t border-line">
                      <th scope="row" className="py-2 pr-3 font-extrabold">
                        {r.name} <small className="text-muted">{formatDiscountValue(r)}</small>
                      </th>
                      <td className="px-3 py-2 text-right">{r.transaction_count}</td>
                      <td className="px-3 py-2 text-right">{r.items_sold}</td>
                      <td className="px-3 py-2 text-right">{formatRupiah(r.gross_revenue)}</td>
                      <td className="px-3 py-2 text-right">−{formatRupiah(r.discount_total)}</td>
                      <td className="py-2 pl-3 text-right">{formatRupiah(r.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line font-extrabold">
                    <th scope="row" className="py-2 pr-3">
                      Total diskon
                    </th>
                    <td colSpan={3} />
                    <td className="px-3 py-2 text-right">
                      −{formatRupiah(report.data.totals.discount_total)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </Card>
          )}
        </>
      ) : null}
    </>
  );
}
