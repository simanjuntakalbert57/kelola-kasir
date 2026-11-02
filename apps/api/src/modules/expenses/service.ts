import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { UserPrincipal } from '../../context.js';
import { isUniqueViolation, type Database, type DbOrTx } from '../../db/client.js';
import {
  expenseCategories,
  expenseHistory,
  expenses,
  outletMembers,
  outlets,
  users,
} from '../../db/schema.js';
import { errors } from '../../errors.js';
import { MEDIA_PATH } from '../../lib/urls.js';
import { dateInZone } from '../../lib/time.js';
import { businessDate, escapeLike, uuid } from '../../lib/validate.js';
import type { StorageConfig } from '../../config.js';
import { writeAudit } from '../audit/audit.js';

export const GROUPS = ['hpp', 'operasional', 'tetap', 'lainnya'] as const;
export const FUNDING_SOURCES = ['drawer', 'owner'] as const;
export const EARLIEST_SPENT_ON = '2020-01-01';

export type ExpenseRow = typeof expenses.$inferSelect;
type CategoryRow = typeof expenseCategories.$inferSelect;
type Role = 'owner' | 'manager';

const CATEGORY_UNIQUE = 'expense_categories_outlet_name_unique';
const RECEIPT_KEY = /^[0-9a-f-]{36}\/expense_receipt\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const categoryInput = z.object({
  group: z.enum(GROUPS),
  name: trimmed(40),
  sort_order: z.number().int().min(0).max(10_000).optional(),
});
export const categoryUpdate = z
  .object({
    group: z.enum(GROUPS),
    name: trimmed(40),
    sort_order: z.number().int().min(0).max(10_000),
    archived: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });

const expenseFields = {
  category_id: uuid,
  spent_on: businessDate,
  description: trimmed(200),
  amount: z.number().int().min(1).max(1_000_000_000),
  funding_source: z.enum(FUNDING_SOURCES),
  receipt_url: z.string().max(500).nullable(),
};
export const expenseInput = z.object({
  id: uuid.optional(),
  ...expenseFields,
  receipt_url: expenseFields.receipt_url.optional(),
});
export const expenseUpdate = z
  .object(expenseFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });
export const deleteInput = z.object({ reason: z.string().trim().min(5).max(200) });
export const restoreInput = z.object({ note: z.string().trim().max(200).optional() }).default({});

export const listQuery = z.object({
  outlet_scope: z.enum(['current', 'all']).default('current'),
  date_from: businessDate.optional(),
  date_to: businessDate.optional(),
  category_id: uuid.optional(),
  group: z.enum(GROUPS).optional(),
  funding_source: z.enum(FUNDING_SOURCES).optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'deleted']).default('active'),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListQuery = z.infer<typeof listQuery>;

export interface Actor {
  principal: UserPrincipal;
  ip?: string | undefined;
}

export class ExpenseService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date,
    private readonly storage: StorageConfig | null,
  ) {}

  // ---------------------------------------------------------------- receipts

  /** `receipt_url` → object key of this outlet, or `422 INVALID_RECEIPT_URL`. */
  private receiptKey(url: string, outletId: string): string {
    const prefix = this.storage ? `${this.storage.apiPublicBaseUrl}${MEDIA_PATH}` : null;
    const key = prefix && url.startsWith(prefix) ? url.slice(prefix.length) : null;
    if (!key || !RECEIPT_KEY.test(key) || !key.startsWith(`${outletId}/`)) {
      throw errors.unprocessable(
        'INVALID_RECEIPT_URL',
        'Invalid receipt URL',
        'receipt_url must be the public_url of an expense_receipt upload for this outlet',
      );
    }
    return key;
  }

  private receiptUrl(key: string | null): string | null {
    return key && this.storage ? `${this.storage.apiPublicBaseUrl}${MEDIA_PATH}${key}` : null;
  }

  // ---------------------------------------------------------------- categories

  toCategory(row: CategoryRow) {
    return {
      id: row.id,
      group: row.categoryGroup as (typeof GROUPS)[number],
      name: row.name,
      sort_order: row.sortOrder,
      archived: row.archivedAt !== null,
    };
  }

  async listCategories(outletId: string, includeArchived: boolean) {
    const groupOrder = sql`case ${expenseCategories.categoryGroup} when 'hpp' then 1 when 'operasional' then 2 when 'tetap' then 3 else 4 end`;
    const rows = await this.db
      .select()
      .from(expenseCategories)
      .where(
        and(
          eq(expenseCategories.outletId, outletId),
          includeArchived ? undefined : isNull(expenseCategories.archivedAt),
        ),
      )
      .orderBy(groupOrder, asc(expenseCategories.sortOrder), asc(expenseCategories.name));
    return rows.map((r) => this.toCategory(r));
  }

  async createCategory(actor: Actor, input: z.infer<typeof categoryInput>) {
    const outletId = actor.principal.outletId;
    try {
      return await this.db.transaction(async (tx) => {
        let sortOrder = input.sort_order;
        if (sortOrder === undefined) {
          const [max] = await tx
            .select({ max: sql<number>`coalesce(max(${expenseCategories.sortOrder}), 0)::int` })
            .from(expenseCategories)
            .where(
              and(
                eq(expenseCategories.outletId, outletId),
                eq(expenseCategories.categoryGroup, input.group),
              ),
            );
          sortOrder = Math.min(10_000, (max?.max ?? 0) + 10);
        }
        const at = this.now();
        const [row] = await tx
          .insert(expenseCategories)
          .values({
            outletId,
            categoryGroup: input.group,
            name: input.name,
            sortOrder,
            createdAt: at,
            updatedAt: at,
          })
          .returning();
        if (!row) throw new Error('failed to create category');
        await writeAudit(tx, {
          outletId,
          actor: { type: 'user', id: actor.principal.id },
          action: 'expense_category.created',
          entityType: 'expense_category',
          entityId: row.id,
          after: this.toCategory(row),
          meta: actor.ip ? { ip: actor.ip } : {},
        });
        return this.toCategory(row);
      });
    } catch (err) {
      throw this.nameTaken(err);
    }
  }

  async updateCategory(actor: Actor, id: string, input: z.infer<typeof categoryUpdate>) {
    const outletId = actor.principal.outletId;
    try {
      return await this.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(expenseCategories)
          .where(and(eq(expenseCategories.id, id), eq(expenseCategories.outletId, outletId)))
          .for('update');
        if (!before) throw errors.notFound('Expense category not found');
        const at = this.now();
        const patch: Partial<typeof expenseCategories.$inferInsert> = {};
        if (input.group !== undefined) patch.categoryGroup = input.group;
        if (input.name !== undefined) patch.name = input.name;
        if (input.sort_order !== undefined) patch.sortOrder = input.sort_order;
        if (input.archived !== undefined) {
          patch.archivedAt = input.archived ? (before.archivedAt ?? at) : null;
        }
        const beforeDto = this.toCategory(before);
        const [row] = await tx
          .update(expenseCategories)
          .set({ ...patch, updatedAt: at })
          .where(eq(expenseCategories.id, id))
          .returning();
        if (!row) throw errors.notFound('Expense category not found');
        const after = this.toCategory(row);
        const changed = (Object.keys(after) as (keyof typeof after)[]).filter(
          (k) => beforeDto[k] !== after[k],
        );
        if (changed.length > 0) {
          await writeAudit(tx, {
            outletId,
            actor: { type: 'user', id: actor.principal.id },
            action: 'expense_category.updated',
            entityType: 'expense_category',
            entityId: id,
            before: Object.fromEntries(changed.map((k) => [k, beforeDto[k]])),
            after: Object.fromEntries(changed.map((k) => [k, after[k]])),
            meta: actor.ip ? { ip: actor.ip } : {},
          });
        }
        return after;
      });
    } catch (err) {
      throw this.nameTaken(err);
    }
  }

  private nameTaken(err: unknown): unknown {
    return isUniqueViolation(err, CATEGORY_UNIQUE)
      ? errors.conflict(
          'EXPENSE_CATEGORY_NAME_TAKEN',
          'Category name already in use',
          'An active category of this outlet already has this name',
        )
      : err;
  }

  /** Category of `outletId` for a new/changed expense: unknown or foreign → 400, archived → 422. */
  private async usableCategory(tx: DbOrTx, outletId: string, id: string): Promise<CategoryRow> {
    const [category] = await tx
      .select()
      .from(expenseCategories)
      .where(and(eq(expenseCategories.id, id), eq(expenseCategories.outletId, outletId)))
      .limit(1);
    if (!category) {
      throw errors.validation([
        { path: 'category_id', message: 'Unknown category for this outlet' },
      ]);
    }
    if (category.archivedAt) {
      throw errors.unprocessable(
        'EXPENSE_CATEGORY_ARCHIVED',
        'Category is archived',
        'Pick an active category',
      );
    }
    return category;
  }

  private assertSpentOn(spentOn: string, timeZone: string): void {
    const today = dateInZone(this.now(), timeZone);
    if (spentOn < EARLIEST_SPENT_ON || spentOn > today) {
      throw errors.validation([
        { path: 'spent_on', message: `spent_on must be between ${EARLIEST_SPENT_ON} and today` },
      ]);
    }
  }

  // ---------------------------------------------------------------- serialisation

  async toExpenses(rows: ExpenseRow[]) {
    if (rows.length === 0) return [];
    const outletIds = [...new Set(rows.map((r) => r.outletId))];
    const categoryIds = [...new Set(rows.map((r) => r.categoryId))];
    const userIds = [
      ...new Set(
        rows.flatMap((r) => [r.createdBy, r.updatedBy, ...(r.deletedBy ? [r.deletedBy] : [])]),
      ),
    ];
    const [outletRows, categoryRows, userRows] = await Promise.all([
      this.db.select().from(outlets).where(inArray(outlets.id, outletIds)),
      this.db.select().from(expenseCategories).where(inArray(expenseCategories.id, categoryIds)),
      this.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, userIds)),
    ]);
    const outletById = new Map(outletRows.map((o) => [o.id, o]));
    const categoryById = new Map(categoryRows.map((c) => [c.id, c]));
    const userById = new Map(userRows.map((u) => [u.id, u]));
    const ref = (id: string) => ({ id, name: userById.get(id)?.name ?? '' });
    return rows.map((r) => {
      const outlet = outletById.get(r.outletId);
      const category = categoryById.get(r.categoryId);
      if (!outlet || !category) throw new Error('expense references are missing');
      return {
        id: r.id,
        outlet: { id: outlet.id, code: outlet.code, name: outlet.name, timezone: outlet.timezone },
        category: this.toCategory(category),
        spent_on: r.spentOn,
        description: r.description,
        amount: r.amount,
        funding_source: r.fundingSource as (typeof FUNDING_SOURCES)[number],
        receipt_url: this.receiptUrl(r.receiptImageKey),
        source: r.source as 'dashboard' | 'cash_movement',
        created_by: ref(r.createdBy),
        created_at: r.createdAt.toISOString(),
        updated_by: ref(r.updatedBy),
        updated_at: r.updatedAt.toISOString(),
        deleted:
          r.deletedAt && r.deletedBy
            ? {
                deleted_at: r.deletedAt.toISOString(),
                deleted_by: ref(r.deletedBy),
                reason: r.deleteReason ?? '',
              }
            : null,
      };
    });
  }

  private async toExpense(row: ExpenseRow) {
    const [dto] = await this.toExpenses([row]);
    if (!dto) throw new Error('expense serialisation failed');
    return dto;
  }

  async toDetail(row: ExpenseRow) {
    const [dto, history] = await Promise.all([
      this.toExpense(row),
      this.db
        .select({ h: expenseHistory, actor: users.name })
        .from(expenseHistory)
        .innerJoin(users, eq(users.id, expenseHistory.actorUserId))
        .where(eq(expenseHistory.expenseId, row.id))
        .orderBy(asc(expenseHistory.createdAt), asc(expenseHistory.id)),
    ]);
    return {
      ...dto,
      history: history.map(({ h, actor }) => ({
        id: h.id,
        action: h.action as 'create' | 'update' | 'delete' | 'restore',
        changes: (h.changes as Record<string, { from: unknown; to: unknown }> | null) ?? null,
        reason: h.reason,
        actor: { id: h.actorUserId, name: actor },
        created_at: h.createdAt.toISOString(),
      })),
    };
  }

  // ---------------------------------------------------------------- create

  async create(actor: Actor, input: z.infer<typeof expenseInput>) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.createOnce(actor, input);
      } catch (err) {
        // Two creates with one client id raced; the loser re-runs as a replay check.
        if (attempt === 0 && isUniqueViolation(err, 'expenses_pkey')) continue;
        throw err;
      }
    }
  }

  private async createOnce(actor: Actor, input: z.infer<typeof expenseInput>) {
    const { principal } = actor;
    const outletId = principal.outletId;
    const result = await this.db.transaction(async (tx) => {
      const [outlet] = await tx.select().from(outlets).where(eq(outlets.id, outletId));
      if (!outlet) throw errors.forbidden('Outlet not found');
      this.assertSpentOn(input.spent_on, outlet.timezone);
      const receiptKey = input.receipt_url ? this.receiptKey(input.receipt_url, outletId) : null;

      if (input.id) {
        const [existing] = await tx.select().from(expenses).where(eq(expenses.id, input.id));
        if (existing) {
          const same =
            existing.outletId === outletId &&
            existing.categoryId === input.category_id &&
            existing.spentOn === input.spent_on &&
            existing.description === input.description &&
            existing.amount === input.amount &&
            existing.fundingSource === input.funding_source &&
            existing.receiptImageKey === receiptKey;
          if (!same) {
            throw errors.conflict(
              'ID_REUSED',
              'Identifier already used by a different expense',
              'An expense with this id exists with other content; nothing was saved',
            );
          }
          return { row: existing, created: false };
        }
      }

      await this.usableCategory(tx, outletId, input.category_id);
      const at = this.now();
      const [row] = await tx
        .insert(expenses)
        .values({
          id: input.id ?? uuidv7(),
          outletId,
          categoryId: input.category_id,
          spentOn: input.spent_on,
          description: input.description,
          amount: input.amount,
          fundingSource: input.funding_source,
          receiptImageKey: receiptKey,
          source: 'dashboard',
          createdBy: principal.id,
          createdAt: at,
          updatedBy: principal.id,
          updatedAt: at,
        })
        .returning();
      if (!row) throw new Error('failed to create expense');
      await tx.insert(expenseHistory).values({
        id: uuidv7(),
        outletId,
        expenseId: row.id,
        action: 'create',
        actorUserId: principal.id,
        createdAt: at,
      });
      await writeAudit(tx, {
        outletId,
        actor: { type: 'user', id: principal.id },
        action: 'expense.created',
        entityType: 'expense',
        entityId: row.id,
        after: this.snapshot(row),
        meta: actor.ip ? { ip: actor.ip } : {},
      });
      return { row, created: true };
    });
    return { expense: await this.toExpense(result.row), created: result.created };
  }

  private snapshot(row: ExpenseRow) {
    return {
      category_id: row.categoryId,
      spent_on: row.spentOn,
      description: row.description,
      amount: row.amount,
      funding_source: row.fundingSource,
      receipt_url: this.receiptUrl(row.receiptImageKey),
      deleted_at: row.deletedAt?.toISOString() ?? null,
      delete_reason: row.deleteReason,
    };
  }

  // ---------------------------------------------------------------- by id

  /**
   * An expense of any outlet where the caller is a member, with the caller's role in that outlet (ADR-0020 §2).
   * Unknown ids and other users' outlets are both `404`.
   */
  async findForMember(
    db: DbOrTx,
    principal: UserPrincipal,
    id: string,
    lock = false,
  ): Promise<{ row: ExpenseRow; role: Role }> {
    const query = db
      .select({ row: expenses, role: outletMembers.role })
      .from(expenses)
      .innerJoin(
        outletMembers,
        and(eq(outletMembers.outletId, expenses.outletId), eq(outletMembers.userId, principal.id)),
      )
      .where(eq(expenses.id, id));
    const [found] = await (lock ? query.for('update', { of: expenses }) : query);
    if (!found) throw errors.notFound('Expense not found');
    return { row: found.row, role: found.role as Role };
  }

  async get(principal: UserPrincipal, id: string) {
    const { row, role } = await this.findForMember(this.db, principal, id);
    // Deleted expenses are for owners only; a manager sees them as unknown.
    if (row.deletedAt && role !== 'owner') throw errors.notFound('Expense not found');
    return this.toDetail(row);
  }

  async update(actor: Actor, id: string, input: z.infer<typeof expenseUpdate>) {
    const { principal } = actor;
    const row = await this.db.transaction(async (tx) => {
      const { row: before } = await this.findForMember(tx, principal, id, true);
      if (before.deletedAt) {
        throw errors.conflict(
          'EXPENSE_DELETED',
          'Expense is deleted',
          'Restore the expense before editing it',
        );
      }
      const [outlet] = await tx.select().from(outlets).where(eq(outlets.id, before.outletId));
      if (!outlet) throw errors.notFound('Expense not found');
      if (input.spent_on !== undefined && input.spent_on !== before.spentOn) {
        this.assertSpentOn(input.spent_on, outlet.timezone);
      }
      const receiptKey =
        input.receipt_url === undefined
          ? undefined
          : input.receipt_url === null
            ? null
            : this.receiptKey(input.receipt_url, before.outletId);

      const patch: Partial<typeof expenses.$inferInsert> = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (input.category_id !== undefined && input.category_id !== before.categoryId) {
        const next = await this.usableCategory(tx, before.outletId, input.category_id);
        const [previous] = await tx
          .select()
          .from(expenseCategories)
          .where(eq(expenseCategories.id, before.categoryId));
        patch.categoryId = next.id;
        changes['category_id'] = {
          from: { id: before.categoryId, name: previous?.name ?? null },
          to: { id: next.id, name: next.name },
        };
      }
      const track = <K extends 'spentOn' | 'description' | 'amount' | 'fundingSource'>(
        field: K,
        api: string,
        next: ExpenseRow[K] | undefined,
      ) => {
        if (next !== undefined && next !== before[field]) {
          patch[field] = next as never;
          changes[api] = { from: before[field], to: next };
        }
      };
      track('spentOn', 'spent_on', input.spent_on);
      track('description', 'description', input.description);
      track('amount', 'amount', input.amount);
      track('fundingSource', 'funding_source', input.funding_source);
      if (receiptKey !== undefined && receiptKey !== before.receiptImageKey) {
        patch.receiptImageKey = receiptKey;
        changes['receipt_url'] = {
          from: this.receiptUrl(before.receiptImageKey),
          to: this.receiptUrl(receiptKey),
        };
      }
      if (Object.keys(changes).length === 0) return before; // no-op: no history row

      const at = this.now();
      const [after] = await tx
        .update(expenses)
        .set({ ...patch, updatedBy: principal.id, updatedAt: at })
        .where(eq(expenses.id, id))
        .returning();
      if (!after) throw errors.notFound('Expense not found');
      await tx.insert(expenseHistory).values({
        id: uuidv7(),
        outletId: before.outletId,
        expenseId: id,
        action: 'update',
        changes,
        actorUserId: principal.id,
        createdAt: at,
      });
      await writeAudit(tx, {
        outletId: before.outletId,
        actor: { type: 'user', id: principal.id },
        action: 'expense.updated',
        entityType: 'expense',
        entityId: id,
        before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.from])),
        after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])),
        meta: actor.ip ? { ip: actor.ip } : {},
      });
      return after;
    });
    return this.toExpense(row);
  }

  async remove(actor: Actor, id: string, reason: string) {
    const { principal } = actor;
    const row = await this.db.transaction(async (tx) => {
      const { row: before, role } = await this.findForMember(tx, principal, id, true);
      if (role !== 'owner') throw errors.forbidden('Only the owner can delete expenses');
      if (before.deletedAt) return before; // idempotent: keep the first reason and history
      const at = this.now();
      const [after] = await tx
        .update(expenses)
        .set({ deletedAt: at, deletedBy: principal.id, deleteReason: reason })
        .where(eq(expenses.id, id))
        .returning();
      if (!after) throw errors.notFound('Expense not found');
      await tx.insert(expenseHistory).values({
        id: uuidv7(),
        outletId: before.outletId,
        expenseId: id,
        action: 'delete',
        reason,
        actorUserId: principal.id,
        createdAt: at,
      });
      await writeAudit(tx, {
        outletId: before.outletId,
        actor: { type: 'user', id: principal.id },
        action: 'expense.deleted',
        entityType: 'expense',
        entityId: id,
        before: this.snapshot(before),
        after: this.snapshot(after),
        meta: actor.ip ? { ip: actor.ip } : {},
      });
      return after;
    });
    return this.toExpense(row);
  }

  async restore(actor: Actor, id: string, note: string | undefined) {
    const { principal } = actor;
    const row = await this.db.transaction(async (tx) => {
      const { row: before, role } = await this.findForMember(tx, principal, id, true);
      if (role !== 'owner') throw errors.forbidden('Only the owner can restore expenses');
      if (!before.deletedAt) return before;
      const at = this.now();
      const [after] = await tx
        .update(expenses)
        .set({ deletedAt: null, deletedBy: null, deleteReason: null })
        .where(eq(expenses.id, id))
        .returning();
      if (!after) throw errors.notFound('Expense not found');
      await tx.insert(expenseHistory).values({
        id: uuidv7(),
        outletId: before.outletId,
        expenseId: id,
        action: 'restore',
        reason: note || null,
        actorUserId: principal.id,
        createdAt: at,
      });
      await writeAudit(tx, {
        outletId: before.outletId,
        actor: { type: 'user', id: principal.id },
        action: 'expense.restored',
        entityType: 'expense',
        entityId: id,
        before: this.snapshot(before),
        after: this.snapshot(after),
        meta: { ...(note ? { note } : {}), ...(actor.ip ? { ip: actor.ip } : {}) },
      });
      return after;
    });
    return this.toExpense(row);
  }

  // ---------------------------------------------------------------- list

  /** Filters shared by the list, its summary and the export (dates filter on `spent_on`). */
  filters(
    outletIds: string[],
    q: Omit<ListQuery, 'cursor' | 'limit' | 'status' | 'outlet_scope'>,
  ): SQL[] {
    const conditions: SQL[] = [inArray(expenses.outletId, outletIds)];
    if (q.date_from) conditions.push(sql`${expenses.spentOn} >= ${q.date_from}`);
    if (q.date_to) conditions.push(sql`${expenses.spentOn} <= ${q.date_to}`);
    if (q.category_id) conditions.push(eq(expenses.categoryId, q.category_id));
    if (q.group) conditions.push(eq(expenseCategories.categoryGroup, q.group));
    if (q.funding_source) conditions.push(eq(expenses.fundingSource, q.funding_source));
    if (q.q) conditions.push(ilike(expenses.description, `%${escapeLike(q.q)}%`));
    return conditions;
  }

  /** Per outlet, only expenses from its `operations_started_on` (needs `outlets` in the query). */
  fromOperationsStart(): SQL {
    return sql`(${outlets.operationsStartedOn} is null or ${expenses.spentOn} >= ${outlets.operationsStartedOn})`;
  }

  async list(outletIds: string[], q: ListQuery) {
    if (q.date_from && q.date_to && q.date_to < q.date_from) {
      throw errors.validation([{ path: 'date_to', message: 'date_to is before date_from' }]);
    }
    const deleted = q.status === 'deleted';
    const base = [
      ...this.filters(outletIds, q),
      deleted ? isNotNull(expenses.deletedAt) : isNull(expenses.deletedAt),
    ];
    const joinCategory = and(
      eq(expenseCategories.id, expenses.categoryId),
      eq(expenseCategories.outletId, expenses.outletId),
    );

    const conditions = [...base];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      const before = deleted
        ? or(
            lt(expenses.deletedAt, new Date(c.t)),
            and(eq(expenses.deletedAt, new Date(c.t)), lt(expenses.id, c.id)),
          )
        : sql`(${expenses.spentOn}, ${expenses.createdAt}, ${expenses.id}) < (${c.s}::date, ${new Date(c.t).toISOString()}::timestamptz, ${c.id}::uuid)`;
      if (before) conditions.push(before);
    }
    const [rows, [summary]] = await Promise.all([
      this.db
        .select({ e: expenses })
        .from(expenses)
        .innerJoin(expenseCategories, joinCategory)
        .where(and(...conditions))
        .orderBy(
          ...(deleted
            ? [desc(expenses.deletedAt), desc(expenses.id)]
            : [desc(expenses.spentOn), desc(expenses.createdAt), desc(expenses.id)]),
        )
        .limit(q.limit + 1),
      this.db
        .select({
          count: sql<number>`count(*)::int`,
          total: sql<string>`coalesce(sum(${expenses.amount}), 0)::text`,
        })
        .from(expenses)
        .innerJoin(expenseCategories, joinCategory)
        .where(and(...base)),
    ]);
    const page = rows.slice(0, q.limit).map((r) => r.e);
    const last = page[page.length - 1];
    return {
      data: await this.toExpenses(page),
      next_cursor:
        rows.length > q.limit && last
          ? Buffer.from(
              JSON.stringify({
                s: last.spentOn,
                t: (deleted ? last.deletedAt : last.createdAt)?.toISOString(),
                id: last.id,
              }),
            ).toString('base64url')
          : null,
      summary: { count: summary?.count ?? 0, total_amount: Number(summary?.total ?? 0) },
    };
  }
}

const cursorSchema = z.object({ s: z.string(), t: z.iso.datetime(), id: uuid });

function decodeCursor(cursor: string): z.infer<typeof cursorSchema> {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw errors.validation([{ path: 'cursor', message: 'Invalid cursor' }]);
  }
}
