import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { errors } from '../../errors.js';
import { parse } from '../../lib/validate.js';
import { resolveOutletScope } from '../expenses/scope.js';
import { requireUser, type Guards } from '../../plugins/auth.js';
import {
  MAX_HOURLY_DAYS,
  loadSalesReport,
  loadSalesSeries,
  loadSummaryByOutlet,
  mergeTotals,
  loadTopProducts,
  rangeQuery,
  resolvePeriod,
} from './queries.js';

const summaryQuery = rangeQuery.extend({
  outlet_scope: z.enum(['current', 'all']).default('current'),
});
const seriesQuery = rangeQuery.extend({ granularity: z.enum(['hour', 'day']) });
const topQuery = rangeQuery.extend({ limit: z.coerce.number().int().min(1).max(50).default(5) });
const reportQuery = rangeQuery.extend({
  group_by: z.enum(['product', 'employee', 'payment_method', 'day']),
});

export function reportRoutes(ctx: AppContext, guards: Guards) {
  const { db } = ctx;

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/dashboard/summary', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const q = parse(summaryQuery, req.query);
      const period = resolvePeriod(q, ctx.now());
      const scope = await resolveOutletScope(db, principal, q.outlet_scope);
      const ids = scope.map((o) => o.id);
      // The previous period has the same length and ends right before this one.
      const previous = {
        from: new Date(period.from.getTime() - (period.to.getTime() - period.from.getTime())),
        to: period.from,
      };
      const [perOutlet, perOutletBefore] = await Promise.all([
        loadSummaryByOutlet(db, ids, period),
        loadSummaryByOutlet(db, ids, previous),
      ]);
      const now = mergeTotals(perOutlet.values());
      const before = mergeTotals(perOutletBefore.values());
      const changePct = (cur: number, prev: number) =>
        prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
      return {
        revenue: now.revenue,
        transaction_count: now.transactionCount,
        average_ticket:
          now.transactionCount > 0 ? Math.floor(now.revenue / now.transactionCount) : 0,
        cash_revenue: now.cashRevenue,
        qris_revenue: now.qrisRevenue,
        cash_count: now.cashCount,
        qris_count: now.qrisCount,
        voided_count: now.voidedCount,
        pending_void_count: now.pendingVoidCount,
        items_sold: now.itemsSold,
        compare_previous_period: {
          revenue_change_pct: changePct(now.revenue, before.revenue),
          items_sold_change_pct: changePct(now.itemsSold, before.itemsSold),
        },
        outlet_scope: q.outlet_scope,
        by_outlet:
          q.outlet_scope === 'all'
            ? scope.map((o) => {
                const t = perOutlet.get(o.id) ?? mergeTotals([]);
                return {
                  outlet_id: o.id,
                  outlet_name: o.name,
                  revenue: t.revenue,
                  cash_revenue: t.cashRevenue,
                  qris_revenue: t.qrisRevenue,
                  cash_count: t.cashCount,
                  qris_count: t.qrisCount,
                  transaction_count: t.transactionCount,
                  items_sold: t.itemsSold,
                };
              })
            : [],
      };
    });

    app.get('/dashboard/sales-series', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const q = parse(seriesQuery, req.query);
      const period = resolvePeriod(q, ctx.now());
      if (q.granularity === 'hour' && period.days > MAX_HOURLY_DAYS) {
        throw errors.validation([
          {
            path: 'granularity',
            message: `Hourly series can span at most ${MAX_HOURLY_DAYS} days`,
          },
        ]);
      }
      return { data: await loadSalesSeries(db, principal.outletId, period, q.granularity) };
    });

    app.get('/dashboard/top-products', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const q = parse(topQuery, req.query);
      const period = resolvePeriod(q, ctx.now());
      return { data: await loadTopProducts(db, principal.outletId, period, q.limit) };
    });

    app.get('/reports/sales', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const q = parse(reportQuery, req.query);
      const period = resolvePeriod(q, ctx.now());
      return { data: await loadSalesReport(db, principal.outletId, period, q.group_by) };
    });
  };
}
