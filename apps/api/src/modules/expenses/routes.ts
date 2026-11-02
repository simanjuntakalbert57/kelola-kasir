import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { errors } from '../../errors.js';
import { dateInZone } from '../../lib/time.js';
import { parse, uuid } from '../../lib/validate.js';
import { requireUser, type Guards } from '../../plugins/auth.js';
import { writeAudit } from '../audit/audit.js';
import { expensesCsv, expensesXlsx, loadExportRows, recapRows } from './export.js';
import { loadExpenseReport, reportQuery, resolveMonths } from './report.js';
import { resolveOutletScope } from './scope.js';
import {
  categoryInput,
  categoryUpdate,
  deleteInput,
  expenseInput,
  expenseUpdate,
  ExpenseService,
  listQuery,
  restoreInput,
} from './service.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const categoryParams = z.object({ expense_category_id: uuid });
const expenseParams = z.object({ expense_id: uuid });
const categoriesQuery = z.object({
  include_archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
const exportQuery = listQuery.omit({ cursor: true, limit: true, status: true, q: true }).extend({
  format: z.enum(['csv', 'xlsx']),
  include_pre_operations: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

/** Outlet categories, expenses, the expense recap and its export (ADR-0021). Owner and manager tokens only. */
export function expenseRoutes(ctx: AppContext, guards: Guards) {
  const { db } = ctx;
  const service = new ExpenseService(db, ctx.now, ctx.config.storage);

  const ownerRole: preHandlerAsyncHookHandler = async (req) => {
    if (req.principal?.type !== 'user' || req.principal.role !== 'owner') {
      throw errors.forbidden('Only the owner can do this');
    }
  };
  const ownerOnly = [guards.owner, ownerRole];

  return async (app: FastifyInstance): Promise<void> => {
    // ------------------------------------------------------------ categories
    app.get('/expense-categories', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const q = parse(categoriesQuery, req.query);
      return { data: await service.listCategories(principal.outletId, q.include_archived) };
    });

    app.post('/expense-categories', { preHandler: ownerOnly }, async (req, reply) => {
      const principal = requireUser(req);
      const body = parse(categoryInput, req.body);
      const created = await service.createCategory({ principal, ip: req.ip }, body);
      return reply.status(201).send(created);
    });

    app.patch(
      '/expense-categories/:expense_category_id',
      { preHandler: ownerOnly },
      async (req) => {
        const principal = requireUser(req);
        const { expense_category_id: id } = parse(categoryParams, req.params);
        const body = parse(categoryUpdate, req.body);
        return service.updateCategory({ principal, ip: req.ip }, id, body);
      },
    );

    // ------------------------------------------------------------ expenses
    app.get('/expenses', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const q = parse(listQuery, req.query);
      if (q.category_id && q.outlet_scope === 'all') {
        throw errors.validation([
          { path: 'category_id', message: 'category_id needs outlet_scope=current' },
        ]);
      }
      if (q.status === 'deleted' && principal.role !== 'owner') {
        throw errors.forbidden('Only the owner can see deleted expenses');
      }
      const scope = await resolveOutletScope(db, principal, q.outlet_scope);
      return service.list(
        scope.map((o) => o.id),
        q,
      );
    });

    app.post('/expenses', { preHandler: guards.owner }, async (req, reply) => {
      const principal = requireUser(req);
      const body = parse(expenseInput, req.body);
      const result = await service.create({ principal, ip: req.ip }, body);
      return reply.status(result.created ? 201 : 200).send(result.expense);
    });

    // Registered next to `/expenses/:expense_id`; the static path wins.
    app.get('/expenses/export', { preHandler: guards.owner }, async (req, reply) => {
      const principal = requireUser(req);
      const q = parse(exportQuery, req.query);
      if (q.category_id && q.outlet_scope === 'all') {
        throw errors.validation([
          { path: 'category_id', message: 'category_id needs outlet_scope=current' },
        ]);
      }
      if (q.date_from && q.date_to && q.date_to < q.date_from) {
        throw errors.validation([{ path: 'date_to', message: 'date_to is before date_from' }]);
      }
      const scope = await resolveOutletScope(db, principal, q.outlet_scope);
      const filter = {
        date_from: q.date_from,
        date_to: q.date_to,
        category_id: q.category_id,
        group: q.group,
        funding_source: q.funding_source,
        q: undefined,
      };
      const rows = await loadExportRows(
        db,
        service,
        scope.map((o) => o.id),
        filter,
        q.include_pre_operations,
      );
      await writeAudit(db, {
        outletId: principal.outletId,
        actor: { type: 'user', id: principal.id },
        action: 'expenses.exported',
        entityType: 'expense',
        meta: { ...q, outlet_ids: scope.map((o) => o.id), rows: rows.length, ip: req.ip },
      });
      const today = dateInZone(ctx.now(), scope[0]?.timezone ?? 'Asia/Jakarta');
      const name = `pengeluaran_${q.date_from ?? 'awal'}_${q.date_to ?? today}.${q.format}`;
      void reply
        .header('content-disposition', `attachment; filename="${name}"`)
        .header('cache-control', 'no-store')
        .type(q.format === 'csv' ? 'text/csv; charset=utf-8' : XLSX_TYPE);
      if (q.format === 'csv') return reply.send(expensesCsv(rows));

      // The `Rekap` sheet covers the months of the period, with the same rules as GET /reports/expenses.
      const currentMonth = today.slice(0, 7);
      const firstRow = rows[0]?.[0];
      const lastRow = rows[rows.length - 1]?.[0];
      const fromMonth =
        q.date_from?.slice(0, 7) ??
        (typeof firstRow === 'string' ? firstRow.slice(0, 7) : currentMonth);
      const toMonth =
        q.date_to?.slice(0, 7) ??
        [currentMonth, typeof lastRow === 'string' ? lastRow.slice(0, 7) : currentMonth]
          .sort()
          .pop();
      const months = resolveMonths(
        { month_from: fromMonth, month_to: toMonth ?? currentMonth },
        currentMonth,
        null,
      );
      const report = await loadExpenseReport(
        db,
        scope,
        months,
        q.outlet_scope,
        q.include_pre_operations,
      );
      return reply.send(await expensesXlsx(rows, recapRows(report)));
    });

    app.get('/expenses/:expense_id', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const { expense_id: id } = parse(expenseParams, req.params);
      return service.get(principal, id);
    });

    app.patch('/expenses/:expense_id', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const { expense_id: id } = parse(expenseParams, req.params);
      const body = parse(expenseUpdate, req.body);
      return service.update({ principal, ip: req.ip }, id, body);
    });

    // Owner or manager of the expense's outlet (DEAR-143); restore stays owner-only. Both are checked per
    // expense outlet inside the service (a user can be owner of one outlet and manager of another).
    app.delete('/expenses/:expense_id', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const { expense_id: id } = parse(expenseParams, req.params);
      const body = parse(deleteInput, req.body);
      return service.remove({ principal, ip: req.ip }, id, body.reason);
    });

    app.post('/expenses/:expense_id/restore', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const { expense_id: id } = parse(expenseParams, req.params);
      const body = parse(restoreInput, req.body);
      return service.restore({ principal, ip: req.ip }, id, body.note);
    });

    // ------------------------------------------------------------ report
    app.get('/reports/expenses', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const q = parse(reportQuery, req.query);
      const scope = await resolveOutletScope(db, principal, q.outlet_scope);
      const currentMonth = dateInZone(ctx.now(), scope[0]?.timezone ?? 'Asia/Jakarta').slice(0, 7);
      const months = resolveMonths(q, currentMonth);
      return loadExpenseReport(db, scope, months, q.outlet_scope, q.include_pre_operations);
    });
  };
}
