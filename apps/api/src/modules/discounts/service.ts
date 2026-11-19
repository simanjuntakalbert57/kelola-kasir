import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { UserPrincipal } from '../../context.js';
import type { Database, DbOrTx } from '../../db/client.js';
import {
  categories,
  devices,
  discountHistory,
  discountOutlets,
  discounts,
  discountTargets,
  outletMembers,
  outlets,
  products,
  users,
} from '../../db/schema.js';
import { errors } from '../../errors.js';
import { isoOrNull } from '../../lib/time.js';
import { writeAudit } from '../audit/audit.js';
import { resolveOutletScope } from '../expenses/scope.js';
import { toCategory } from '../catalog/serialize.js';
import { wibDate } from '../transactions/access.js';
import {
  RULE_FIELDS,
  STATUS_ORDER,
  statusOf,
  validateRule,
  type DiscountAction,
  type DiscountInput,
  type DiscountSnapshot,
  type DiscountStatus,
  type DiscountUpdate,
  type OutletTargets,
  type RuleFields,
} from './rules.js';

type DiscountRow = typeof discounts.$inferSelect;

export interface Actor {
  principal: UserPrincipal;
  ip?: string | undefined;
}

const userRef = (id: string, names: Map<string, string>) => ({ id, name: names.get(id) ?? '-' });

/** `1.2.3` style versions compare numerically per segment; a missing segment is 0. */
export function versionBelow(version: string | null, minimum: string): boolean {
  if (!version) return true;
  const parse = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(version);
  const b = parse(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

const sortedIds = (ids: Iterable<string>): string[] => [...ids].sort();

/** Outlets where the user is owner right now (read from the membership table, not from the token). */
async function ownedOutletIds(db: DbOrTx, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: outletMembers.outletId })
    .from(outletMembers)
    .where(and(eq(outletMembers.userId, userId), eq(outletMembers.role, 'owner')));
  return new Set(rows.map((r) => r.id));
}

interface State {
  row: DiscountRow;
  /** Outlets the discount covers now (not removed). */
  outletIds: string[];
  targets: Record<string, OutletTargets>;
}

/** Discounts with their active outlets and targets, loaded with three queries regardless of the count. */
async function loadStates(db: DbOrTx, rows: DiscountRow[]): Promise<Map<string, State>> {
  const states = new Map<string, State>(
    rows.map((row) => [row.id, { row, outletIds: [], targets: {} }]),
  );
  if (rows.length === 0) return states;
  const ids = rows.map((r) => r.id);
  const [outletRows, targetRows] = await Promise.all([
    db
      .select({ discountId: discountOutlets.discountId, outletId: discountOutlets.outletId })
      .from(discountOutlets)
      .where(and(inArray(discountOutlets.discountId, ids), isNull(discountOutlets.removedAt))),
    db.select().from(discountTargets).where(inArray(discountTargets.discountId, ids)),
  ]);
  for (const o of outletRows) {
    const s = states.get(o.discountId);
    if (!s) continue;
    s.outletIds.push(o.outletId);
    s.targets[o.outletId] = { product_ids: [], category_ids: [] };
  }
  for (const t of targetRows) {
    const bucket = states.get(t.discountId)?.targets[t.outletId];
    if (!bucket) continue;
    if (t.productId) bucket.product_ids.push(t.productId);
    if (t.categoryId) bucket.category_ids.push(t.categoryId);
  }
  for (const s of states.values()) {
    for (const t of Object.values(s.targets)) {
      t.product_ids.sort();
      t.category_ids.sort();
    }
  }
  return states;
}

const fieldsOf = (row: DiscountRow): RuleFields => ({
  name: row.name,
  target_type: row.targetType as RuleFields['target_type'],
  type: row.type as RuleFields['type'],
  value: row.value,
  starts_on: row.startsOn,
  ends_on: row.endsOn,
  days_of_week: row.daysOfWeek,
  time_start: row.timeStart,
  time_end: row.timeEnd,
  is_active: row.isActive,
});

export function snapshotOf(
  fields: RuleFields,
  deleted: boolean,
  targets: Record<string, OutletTargets>,
): DiscountSnapshot {
  return { ...fields, deleted, targets };
}

const flat = (
  targets: Record<string, OutletTargets>,
  key: 'product_ids' | 'category_ids',
): string[] => sortedIds(Object.values(targets).flatMap((t) => t[key]));

/** `{ field: { from, to } }` between two states, with the `DiscountUpdate` field names. */
function diffOf(
  from: RuleFields,
  to: RuleFields,
  fromTargets: Record<string, OutletTargets>,
  toTargets: Record<string, OutletTargets>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of RULE_FIELDS) {
    if (JSON.stringify(from[key]) !== JSON.stringify(to[key])) {
      changes[key] = { from: from[key], to: to[key] };
    }
  }
  for (const key of ['product_ids', 'category_ids'] as const) {
    const a = flat(fromTargets, key);
    const b = flat(toTargets, key);
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { from: a, to: b };
  }
  return changes;
}

interface Catalog {
  outletsById: Map<string, { id: string; code: string; name: string; timezone: string }>;
  products: Map<string, { id: string; name: string; price: number; categoryId: string }>;
  categories: Map<string, { id: string; name: string; sortOrder: number }>;
  names: Map<string, string>;
}

async function loadCatalog(
  db: DbOrTx,
  states: State[],
  extraUserIds: string[] = [],
): Promise<Catalog> {
  const outletIds = new Set<string>();
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();
  const userIds = new Set<string>(extraUserIds);
  for (const s of states) {
    userIds.add(s.row.createdBy);
    userIds.add(s.row.updatedBy);
    if (s.row.deletedBy) userIds.add(s.row.deletedBy);
    for (const id of s.outletIds) outletIds.add(id);
    for (const t of Object.values(s.targets)) {
      t.product_ids.forEach((id) => productIds.add(id));
      t.category_ids.forEach((id) => categoryIds.add(id));
    }
  }
  const [outletRows, productRows, categoryRows, userRows] = await Promise.all([
    outletIds.size
      ? db
          .select({
            id: outlets.id,
            code: outlets.code,
            name: outlets.name,
            timezone: outlets.timezone,
          })
          .from(outlets)
          .where(inArray(outlets.id, [...outletIds]))
      : [],
    productIds.size
      ? db
          .select({
            id: products.id,
            name: products.name,
            price: products.price,
            categoryId: products.categoryId,
          })
          .from(products)
          .where(inArray(products.id, [...productIds]))
      : [],
    categoryIds.size
      ? db
          .select({ id: categories.id, name: categories.name, sortOrder: categories.sortOrder })
          .from(categories)
          .where(inArray(categories.id, [...categoryIds]))
      : [],
    userIds.size
      ? db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, [...userIds]))
      : [],
  ]);
  return {
    outletsById: new Map(outletRows.map((o) => [o.id, o])),
    products: new Map(productRows.map((p) => [p.id, { ...p, price: Number(p.price) }])),
    categories: new Map(categoryRows.map((c) => [c.id, c])),
    names: new Map(userRows.map((u) => [u.id, u.name])),
  };
}

function toDto(state: State, visible: Set<string>, cat: Catalog, today: string) {
  const { row } = state;
  const outletsOut = state.outletIds
    .filter((id) => visible.has(id))
    .flatMap((id) => {
      const outlet = cat.outletsById.get(id);
      return outlet ? [outlet] : [];
    })
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((outlet) => {
      const t = state.targets[outlet.id] ?? { product_ids: [], category_ids: [] };
      return {
        outlet: { id: outlet.id, code: outlet.code, name: outlet.name, timezone: outlet.timezone },
        products: t.product_ids
          .flatMap((id) => {
            const p = cat.products.get(id);
            return p ? [p] : [];
          })
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
          .map((p) => ({ id: p.id, name: p.name, price: p.price, category_id: p.categoryId })),
        categories: t.category_ids
          .flatMap((id) => {
            const c = cat.categories.get(id);
            return c ? [c] : [];
          })
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
          .map(toCategory),
      };
    });
  return {
    id: row.id,
    name: row.name,
    target_type: row.targetType,
    type: row.type,
    value: row.value,
    starts_on: row.startsOn,
    ends_on: row.endsOn,
    days_of_week: row.daysOfWeek,
    time_start: row.timeStart,
    time_end: row.timeEnd,
    version: row.version,
    is_active: row.isActive,
    status: statusOf(row, today),
    outlets: outletsOut,
    created_by: userRef(row.createdBy, cat.names),
    created_at: row.createdAt.toISOString(),
    updated_by: userRef(row.updatedBy, cat.names),
    updated_at: row.updatedAt.toISOString(),
    deleted:
      row.deletedAt && row.deletedBy && row.deleteReason
        ? {
            deleted_at: row.deletedAt.toISOString(),
            deleted_by: userRef(row.deletedBy, cat.names),
            reason: row.deleteReason,
          }
        : null,
  };
}

export type DiscountDto = ReturnType<typeof toDto>;

export class DiscountService {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date,
    private readonly minAppVersion: string,
  ) {}

  // ------------------------------------------------------------------ read

  /** Devices of the outlets whose app cannot apply discounts yet (older than the minimum, or unknown). */
  private async outdatedDevices(outletIds: string[]) {
    const rows = await this.db
      .select({
        id: devices.id,
        code: devices.code,
        name: devices.name,
        appVersion: devices.appVersion,
        lastSeenAt: devices.lastSeenAt,
        outletId: outlets.id,
        outletCode: outlets.code,
        outletName: outlets.name,
        outletTimezone: outlets.timezone,
      })
      .from(devices)
      .innerJoin(outlets, eq(outlets.id, devices.outletId))
      .where(
        and(
          inArray(devices.outletId, outletIds),
          isNull(devices.revokedAt),
          sql`${devices.pairedAt} is not null`,
        ),
      )
      .orderBy(asc(outlets.code), asc(devices.code));
    return rows
      .filter((d) => versionBelow(d.appVersion, this.minAppVersion))
      .map((d) => ({
        device_id: d.id,
        outlet: {
          id: d.outletId,
          code: d.outletCode,
          name: d.outletName,
          timezone: d.outletTimezone,
        },
        code: d.code,
        name: d.name,
        app_version: d.appVersion,
        last_seen_at: isoOrNull(d.lastSeenAt),
      }));
  }

  async list(
    principal: UserPrincipal,
    query: { outlet_scope: 'current' | 'all'; status?: DiscountStatus | undefined },
  ) {
    if (query.status === 'deleted' && principal.role !== 'owner') {
      throw errors.forbidden('Only the owner can see deleted discounts');
    }
    const scope = await resolveOutletScope(this.db, principal, query.outlet_scope);
    const scopeIds = scope.map((o) => o.id);
    const rows = await this.db
      .select()
      .from(discounts)
      .where(
        sql`exists (select 1 from ${discountOutlets} o where o.discount_id = ${discounts.id}
              and o.outlet_id in (${sql.join(
                scopeIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )}) and o.removed_at is null)`,
      );
    const today = wibDate(this.now());
    const wanted = rows.filter((r) =>
      query.status ? statusOf(r, today) === query.status : r.deletedAt === null,
    );
    const states = [...(await loadStates(this.db, wanted)).values()];
    const cat = await loadCatalog(this.db, states);
    const visible = await this.visibleOutlets(principal);
    const data = states
      .map((s) => toDto(s, visible, cat, today))
      .sort(
        (a, b) =>
          STATUS_ORDER[a.status as DiscountStatus] - STATUS_ORDER[b.status as DiscountStatus] ||
          b.starts_on.localeCompare(a.starts_on) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      );
    return { data, outdated_devices: await this.outdatedDevices(scopeIds) };
  }

  /** What the caller may see of a discount: a manager only their outlet, an owner every outlet they own. */
  private async visibleOutlets(principal: UserPrincipal): Promise<Set<string>> {
    return principal.role === 'owner'
      ? ownedOutletIds(this.db, principal.id)
      : new Set([principal.outletId]);
  }

  async get(principal: UserPrincipal, id: string) {
    const [row] = await this.db.select().from(discounts).where(eq(discounts.id, id));
    if (!row) throw errors.notFound('Discount not found');
    const state = (await loadStates(this.db, [row])).get(id);
    if (!state) throw errors.notFound('Discount not found');
    const visible = await this.visibleOutlets(principal);
    const covers = state.outletIds.some((o) => visible.has(o));
    if (!covers || (principal.role !== 'owner' && row.deletedAt)) {
      throw errors.notFound('Discount not found');
    }
    const history = await this.db
      .select()
      .from(discountHistory)
      .where(eq(discountHistory.discountId, id))
      .orderBy(asc(discountHistory.version));
    const cat = await loadCatalog(
      this.db,
      [state],
      history.map((h) => h.actorUserId),
    );
    const owner = principal.role === 'owner';
    return {
      ...toDto(state, visible, cat, wibDate(this.now())),
      history: history.map((h) => ({
        id: h.id,
        version: h.version,
        action: h.action as DiscountAction,
        ...(owner ? { changes: h.changes } : {}),
        reason: h.reason,
        actor: userRef(h.actorUserId, cat.names),
        created_at: h.createdAt.toISOString(),
      })),
    };
  }

  /** Products and categories of the scope grouped by normalized name for the "Semua cabang" picker. */
  async targetOptions(principal: UserPrincipal, scopeName: 'current' | 'all') {
    const scope = await resolveOutletScope(this.db, principal, scopeName);
    const ids = scope.map((o) => o.id);
    const norm = (col: typeof products.name | typeof categories.name) =>
      sql<string>`regexp_replace(lower(btrim(${col})), '[[:space:]]+', ' ', 'g')`;
    const [productRows, categoryRows, counts] = await Promise.all([
      this.db
        .select({
          id: products.id,
          outletId: products.outletId,
          name: products.name,
          norm: norm(products.name),
          price: products.price,
          categoryId: products.categoryId,
          categoryName: categories.name,
        })
        .from(products)
        .innerJoin(categories, eq(categories.id, products.categoryId))
        .where(
          and(
            inArray(products.outletId, ids),
            isNull(products.deletedAt),
            eq(products.isActive, true),
          ),
        ),
      this.db
        .select({
          id: categories.id,
          outletId: categories.outletId,
          name: categories.name,
          norm: norm(categories.name),
        })
        .from(categories)
        .where(and(inArray(categories.outletId, ids), isNull(categories.deletedAt))),
      this.db
        .select({ categoryId: products.categoryId, n: sql<number>`count(*)::int` })
        .from(products)
        .where(
          and(
            inArray(products.outletId, ids),
            isNull(products.deletedAt),
            eq(products.isActive, true),
          ),
        )
        .groupBy(products.categoryId),
    ]);
    const outletById = new Map(scope.map((o) => [o.id, o]));
    const countOf = new Map(counts.map((c) => [c.categoryId, c.n]));
    const ref = (outletId: string) => {
      const o = outletById.get(outletId);
      return o ? { id: o.id, code: o.code, name: o.name, timezone: o.timezone } : null;
    };
    const rank = (outletId: string) =>
      (outletId === principal.outletId ? '0' : '1') + (outletById.get(outletId)?.code ?? '');

    const group = <T extends { outletId: string; name: string; norm: string }>(rows: T[]) => {
      const groups = new Map<string, T[]>();
      for (const r of rows) groups.set(r.norm, [...(groups.get(r.norm) ?? []), r]);
      return [...groups.entries()].map(([key, members]) => {
        const sorted = [...members].sort((a, b) =>
          rank(a.outletId).localeCompare(rank(b.outletId)),
        );
        return { key: `name:${key}`, name: sorted[0]?.name ?? '', members: sorted };
      });
    };
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return {
      products: group(productRows)
        .map((g) => ({
          key: g.key,
          name: g.name,
          outlets: g.members.flatMap((m) => {
            const outlet = ref(m.outletId);
            return outlet
              ? [
                  {
                    outlet,
                    product_id: m.id,
                    price: Number(m.price),
                    category_id: m.categoryId,
                    category_name: m.categoryName,
                  },
                ]
              : [];
          }),
        }))
        .sort(byName),
      categories: group(categoryRows)
        .map((g) => ({
          key: g.key,
          name: g.name,
          outlets: g.members.flatMap((m) => {
            const outlet = ref(m.outletId);
            return outlet
              ? [{ outlet, category_id: m.id, product_count: countOf.get(m.id) ?? 0 }]
              : [];
          }),
        }))
        .sort(byName),
    };
  }

  // ----------------------------------------------------------------- write

  /**
   * Validates the target ids and returns them grouped by outlet. Unknown or deleted ids are
   * `DISCOUNT_TARGET_INVALID`; an outlet where the caller is not owner is `403`.
   */
  private async resolveTargets(
    db: DbOrTx,
    owned: Set<string>,
    targetType: 'product' | 'category',
    ids: string[],
  ): Promise<Record<string, OutletTargets>> {
    const rows =
      targetType === 'product'
        ? await db
            .select({ id: products.id, outletId: products.outletId })
            .from(products)
            .where(and(inArray(products.id, ids), isNull(products.deletedAt)))
        : await db
            .select({ id: categories.id, outletId: categories.outletId })
            .from(categories)
            .where(and(inArray(categories.id, ids), isNull(categories.deletedAt)));
    if (rows.length !== new Set(ids).size) {
      throw errors.unprocessable(
        'DISCOUNT_TARGET_INVALID',
        'Invalid discount target',
        `Some ${targetType === 'product' ? 'products' : 'categories'} do not exist or were deleted`,
      );
    }
    const targets: Record<string, OutletTargets> = {};
    for (const r of rows) {
      if (!owned.has(r.outletId)) {
        throw errors.forbidden('You are not the owner of every outlet of this discount');
      }
      const bucket = (targets[r.outletId] ??= { product_ids: [], category_ids: [] });
      (targetType === 'product' ? bucket.product_ids : bucket.category_ids).push(r.id);
    }
    for (const t of Object.values(targets)) {
      t.product_ids.sort();
      t.category_ids.sort();
    }
    return targets;
  }

  /** Brings `discount_outlets` and `discount_targets` in line with `targets`, bumping every outlet's sync cursor. */
  private async applyTargets(
    tx: DbOrTx,
    discountId: string,
    targets: Record<string, OutletTargets>,
    replaceTargets: boolean,
  ): Promise<void> {
    const existing = await tx
      .select()
      .from(discountOutlets)
      .where(eq(discountOutlets.discountId, discountId));
    const have = new Map(existing.map((o) => [o.outletId, o]));
    const now = this.now();
    for (const outletId of Object.keys(targets)) {
      const row = have.get(outletId);
      if (!row) {
        await tx.insert(discountOutlets).values({ discountId, outletId });
      } else if (row.removedAt) {
        await tx
          .update(discountOutlets)
          .set({ removedAt: null })
          .where(
            and(eq(discountOutlets.discountId, discountId), eq(discountOutlets.outletId, outletId)),
          );
      }
    }
    for (const row of existing) {
      if (!row.removedAt && !targets[row.outletId]) {
        await tx
          .update(discountOutlets)
          .set({ removedAt: now })
          .where(
            and(
              eq(discountOutlets.discountId, discountId),
              eq(discountOutlets.outletId, row.outletId),
            ),
          );
      }
    }
    if (replaceTargets) {
      await tx.delete(discountTargets).where(eq(discountTargets.discountId, discountId));
      const values = Object.entries(targets).flatMap(([outletId, t]) => [
        ...t.product_ids.map((productId) => ({ discountId, outletId, productId })),
        ...t.category_ids.map((categoryId) => ({ discountId, outletId, categoryId })),
      ]);
      if (values.length > 0) await tx.insert(discountTargets).values(values);
    }
    // Trigger `kk_touch_updated` gives every covered outlet a new `updated_seq`, so each phone pulls the new version.
    await tx
      .update(discountOutlets)
      .set({ updatedAt: now })
      .where(and(eq(discountOutlets.discountId, discountId), isNull(discountOutlets.removedAt)));
  }

  private async record(
    tx: DbOrTx,
    actor: Actor,
    row: DiscountRow,
    entry: {
      action: DiscountAction;
      snapshot: DiscountSnapshot;
      changes?: Record<string, { from: unknown; to: unknown }> | null;
      reason?: string;
    },
  ): Promise<void> {
    await tx.insert(discountHistory).values({
      discountId: row.id,
      version: row.version,
      action: entry.action,
      snapshot: entry.snapshot,
      changes: entry.changes ?? null,
      reason: entry.reason ?? null,
      actorUserId: actor.principal.id,
    });
    const verb = {
      create: 'created',
      update: 'updated',
      activate: 'activated',
      deactivate: 'deactivated',
      delete: 'deleted',
    }[entry.action];
    const changes = entry.changes ?? {};
    await writeAudit(tx, {
      outletId: actor.principal.outletId,
      actor: { type: 'user', id: actor.principal.id },
      action: `discount.${verb}`,
      entityType: 'discount',
      entityId: row.id,
      before:
        entry.action === 'create'
          ? null
          : Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.from])),
      after:
        entry.action === 'create'
          ? entry.snapshot
          : Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])),
      meta: {
        version: row.version,
        name: row.name,
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(actor.ip ? { ip: actor.ip } : {}),
      },
    });
  }

  private async dto(db: DbOrTx, principal: UserPrincipal, id: string): Promise<DiscountDto> {
    const [row] = await db.select().from(discounts).where(eq(discounts.id, id));
    if (!row) throw errors.notFound('Discount not found');
    const state = (await loadStates(db, [row])).get(id);
    if (!state) throw errors.notFound('Discount not found');
    const cat = await loadCatalog(db, [state]);
    return toDto(state, await ownedOutletIds(db, principal.id), cat, wibDate(this.now()));
  }

  async create(actor: Actor, input: DiscountInput): Promise<DiscountDto> {
    const { principal } = actor;
    const targetIds = input.target_type === 'product' ? input.product_ids : input.category_ids;
    const otherIds = input.target_type === 'product' ? input.category_ids : input.product_ids;
    if (!targetIds) {
      throw errors.validation([
        {
          path: input.target_type === 'product' ? 'product_ids' : 'category_ids',
          message: `Required when target_type is ${input.target_type}`,
        },
      ]);
    }
    if (otherIds) {
      throw errors.validation([
        {
          path: input.target_type === 'product' ? 'category_ids' : 'product_ids',
          message: `Not allowed when target_type is ${input.target_type}`,
        },
      ]);
    }
    const fields: RuleFields = {
      name: input.name,
      target_type: input.target_type,
      type: input.type,
      value: input.value,
      starts_on: input.starts_on,
      ends_on: input.ends_on ?? null,
      days_of_week: input.days_of_week ? [...input.days_of_week].sort((a, b) => a - b) : null,
      time_start: input.time_start ?? null,
      time_end: input.time_end ?? null,
      is_active: input.is_active,
    };
    validateRule(fields);

    const id = await this.db.transaction(async (tx) => {
      const owned = await ownedOutletIds(tx, principal.id);
      const targets = await this.resolveTargets(tx, owned, input.target_type, targetIds);
      const now = this.now();
      const [row] = await tx
        .insert(discounts)
        .values({
          name: fields.name,
          targetType: fields.target_type,
          type: fields.type,
          value: fields.value,
          startsOn: fields.starts_on,
          endsOn: fields.ends_on,
          daysOfWeek: fields.days_of_week,
          timeStart: fields.time_start,
          timeEnd: fields.time_end,
          isActive: fields.is_active,
          createdBy: principal.id,
          createdAt: now,
          updatedBy: principal.id,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error('discount insert returned no row');
      await this.applyTargets(tx, row.id, targets, true);
      await this.record(tx, actor, row, {
        action: 'create',
        snapshot: snapshotOf(fields, false, targets),
      });
      return row.id;
    });
    return this.dto(this.db, principal, id);
  }

  async update(actor: Actor, id: string, body: DiscountUpdate): Promise<DiscountDto> {
    const { principal } = actor;
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(discounts).where(eq(discounts.id, id)).for('update');
      if (!locked) throw errors.notFound('Discount not found');
      const state = (await loadStates(tx, [locked])).get(id);
      if (!state) throw errors.notFound('Discount not found');
      const owned = await ownedOutletIds(tx, principal.id);
      if (!state.outletIds.some((o) => owned.has(o))) throw errors.notFound('Discount not found');
      if (!state.outletIds.every((o) => owned.has(o))) {
        throw errors.forbidden('You are not the owner of every outlet of this discount');
      }
      if (locked.deletedAt) {
        throw errors.conflict(
          'DISCOUNT_DELETED',
          'Discount is deleted',
          'A deleted discount cannot be edited',
        );
      }
      if (locked.version !== body.version) {
        throw errors.conflict(
          'DISCOUNT_VERSION_CONFLICT',
          'Discount was changed by someone else',
          `Current version is ${locked.version}; reload and try again`,
        );
      }

      const before = fieldsOf(locked);
      const next: RuleFields = {
        name: body.name ?? before.name,
        target_type: body.target_type ?? before.target_type,
        type: body.type ?? before.type,
        value: body.value ?? before.value,
        starts_on: body.starts_on ?? before.starts_on,
        ends_on: body.ends_on === undefined ? before.ends_on : body.ends_on,
        days_of_week:
          body.days_of_week === undefined
            ? before.days_of_week
            : body.days_of_week && [...body.days_of_week].sort((a, b) => a - b),
        time_start: body.time_start === undefined ? before.time_start : body.time_start,
        time_end: body.time_end === undefined ? before.time_end : body.time_end,
        is_active: body.is_active ?? before.is_active,
      };
      validateRule(next);

      const typeChanged = next.target_type !== before.target_type;
      const wantedIds = next.target_type === 'product' ? body.product_ids : body.category_ids;
      const strayIds = next.target_type === 'product' ? body.category_ids : body.product_ids;
      if (strayIds) {
        throw errors.validation([
          {
            path: next.target_type === 'product' ? 'category_ids' : 'product_ids',
            message: `Not allowed when target_type is ${next.target_type}`,
          },
        ]);
      }
      if (typeChanged && !wantedIds) {
        throw errors.validation([
          {
            path: next.target_type === 'product' ? 'product_ids' : 'category_ids',
            message: `Required when target_type changes to ${next.target_type}`,
          },
        ]);
      }
      const targets = wantedIds
        ? await this.resolveTargets(tx, owned, next.target_type, wantedIds)
        : state.targets;

      const changes = diffOf(before, next, state.targets, targets);
      if (Object.keys(changes).length === 0) return; // no-op: no new version

      const keys = Object.keys(changes);
      const action: DiscountAction =
        keys.length === 1 && keys[0] === 'is_active'
          ? next.is_active
            ? 'activate'
            : 'deactivate'
          : 'update';
      const now = this.now();
      const [row] = await tx
        .update(discounts)
        .set({
          name: next.name,
          targetType: next.target_type,
          type: next.type,
          value: next.value,
          startsOn: next.starts_on,
          endsOn: next.ends_on,
          daysOfWeek: next.days_of_week,
          timeStart: next.time_start,
          timeEnd: next.time_end,
          isActive: next.is_active,
          version: locked.version + 1,
          updatedBy: principal.id,
          updatedAt: now,
        })
        .where(eq(discounts.id, id))
        .returning();
      if (!row) throw new Error('discount update returned no row');
      await this.applyTargets(tx, id, targets, wantedIds !== undefined);
      await this.record(tx, actor, row, {
        action,
        snapshot: snapshotOf(next, false, targets),
        changes,
      });
    });
    return this.dto(this.db, principal, id);
  }

  async remove(actor: Actor, id: string, reason: string): Promise<DiscountDto> {
    const { principal } = actor;
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(discounts).where(eq(discounts.id, id)).for('update');
      if (!locked) throw errors.notFound('Discount not found');
      const state = (await loadStates(tx, [locked])).get(id);
      if (!state) throw errors.notFound('Discount not found');
      const owned = await ownedOutletIds(tx, principal.id);
      if (!state.outletIds.some((o) => owned.has(o))) throw errors.notFound('Discount not found');
      if (!state.outletIds.every((o) => owned.has(o))) {
        throw errors.forbidden('You are not the owner of every outlet of this discount');
      }
      if (locked.deletedAt) return; // idempotent: the first reason stays
      const now = this.now();
      const [row] = await tx
        .update(discounts)
        .set({
          deletedAt: now,
          deletedBy: principal.id,
          deleteReason: reason,
          version: locked.version + 1,
          updatedBy: principal.id,
          updatedAt: now,
        })
        .where(eq(discounts.id, id))
        .returning();
      if (!row) throw new Error('discount delete returned no row');
      await this.applyTargets(tx, id, state.targets, false);
      await this.record(tx, actor, row, {
        action: 'delete',
        snapshot: snapshotOf(fieldsOf(row), true, state.targets),
        reason,
      });
    });
    return this.dto(this.db, principal, id);
  }
}
