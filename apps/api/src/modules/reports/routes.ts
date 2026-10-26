import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { errors } from '../../errors.js';
import { parse } from '../../lib/validate.js';
import { requireUser, type Guards } from '../../plugins/auth.js';
import {
  MAX_HOURLY_DAYS,
  loadSalesReport,
  loadSalesSeries,
  loadSummary,
  loadTopProducts,
  rangeQuery,
  resolvePeriod,
} from './queries.js';

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
      const q = parse(rangeQuery, req.query);
      const period = resolvePeriod(q, ctx.now());
      // The previous period has the same length and ends right before this one.
      const previous = {
        from: new Date(period.from.getTime() - (period.to.getTime() - period.from.getTime())),
        to: period.from,
      };
      const [now, before] = await Promise.all([
        loadSummary(db, principal.outletId, period),
        loadSummary(db, principal.outletId, previous),
      ]);
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
        compare_previous_period: {
          revenue_change_pct:
            before.revenue > 0
              ? Math.round(((now.revenue - before.revenue) / before.revenue) * 1000) / 10
              : null,
        },
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
