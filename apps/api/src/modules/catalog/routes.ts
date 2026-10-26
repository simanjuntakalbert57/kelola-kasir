import { and, asc, eq, ilike, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import type { DbOrTx } from '../../db/client.js';
import { categories, products } from '../../db/schema.js';
import { errors } from '../../errors.js';
import { imageUrlSchema } from '../../lib/urls.js';
import { escapeLike, parse, uuid } from '../../lib/validate.js';
import { requestOutletId, requireUser, type Guards } from '../../plugins/auth.js';
import { writeAudit } from '../audit/audit.js';
import { setSoldOut } from './availability.js';
import { toCategory, toProduct } from './serialize.js';

const rupiah = z.number().int().min(0).max(1_000_000_000);
const sortOrder = z.number().int().min(-100_000).max(100_000);
const categoryId = z.object({ category_id: uuid });
const productId = z.object({ product_id: uuid });

const categoryBody = z.object({ name: z.string().trim().min(1).max(40), sort_order: sortOrder });
const categoryCreate = categoryBody.partial({ sort_order: true });
const categoryUpdate = categoryBody
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });

const listProductsQuery = z.object({
  category_id: uuid.optional(),
  is_active: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(60).optional(),
});

/** Current value of the global sync sequence, so a snapshot can hand out a `/sync/pull` cursor. */
export async function currentSyncSeq(db: DbOrTx): Promise<number> {
  const result = await db.execute<{ seq: string }>(
    sql`select case when is_called then last_value else 0 end::text as seq from catalog_seq`,
  );
  return Number(result.rows[0]?.seq ?? 0);
}

export function encodeSyncCursor(seq: number): string {
  return Buffer.from(JSON.stringify({ s: seq })).toString('base64url');
}

export function catalogRoutes(ctx: AppContext, guards: Guards) {
  const { db, config } = ctx;
  const imageUrl = imageUrlSchema(config.storage?.publicBaseUrl);
  const productBody = z.object({
    category_id: uuid,
    name: z.string().trim().min(1).max(60),
    image_url: imageUrl.nullable(),
    price: rupiah,
    is_active: z.boolean(),
    is_favorite: z.boolean(),
    sort_order: sortOrder,
  });
  const productCreate = productBody.partial({
    image_url: true,
    is_active: true,
    is_favorite: true,
    sort_order: true,
  });
  const productUpdate = productBody
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });

  async function requireCategory(tx: DbOrTx, outletId: string, id: string): Promise<void> {
    const [row] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(eq(categories.id, id), eq(categories.outletId, outletId), isNull(categories.deletedAt)),
      )
      .limit(1);
    if (!row) {
      throw errors.validation([{ path: 'category_id', message: 'Category does not exist' }]);
    }
  }

  async function findProduct(tx: DbOrTx, outletId: string, id: string) {
    const [row] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.outletId, outletId), isNull(products.deletedAt)))
      .limit(1);
    if (!row) throw errors.notFound('Product not found');
    return row;
  }

  return async (app: FastifyInstance): Promise<void> => {
    // ------------------------------------------------------------ snapshot
    app.get('/catalog', { preHandler: guards.ownerOrDevice }, async (req) => {
      const outletId = requestOutletId(req);
      // Read the cursor first: rows changed while we read are simply delivered again by the next pull.
      const seq = await currentSyncSeq(db);
      const [cats, prods] = await Promise.all([
        db
          .select()
          .from(categories)
          .where(and(eq(categories.outletId, outletId), isNull(categories.deletedAt)))
          .orderBy(asc(categories.sortOrder), asc(categories.name)),
        db
          .select()
          .from(products)
          .where(
            and(
              eq(products.outletId, outletId),
              isNull(products.deletedAt),
              eq(products.isActive, true),
            ),
          )
          .orderBy(asc(products.sortOrder), asc(products.name)),
      ]);
      return {
        categories: cats.map(toCategory),
        products: prods.map(toProduct),
        cursor: encodeSyncCursor(seq),
      };
    });

    // ------------------------------------------------------------ categories
    app.get('/categories', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const rows = await db
        .select()
        .from(categories)
        .where(and(eq(categories.outletId, principal.outletId), isNull(categories.deletedAt)))
        .orderBy(asc(categories.sortOrder), asc(categories.name));
      return { data: rows.map(toCategory) };
    });

    app.post('/categories', { preHandler: guards.owner }, async (req, reply) => {
      const principal = requireUser(req);
      const body = parse(categoryCreate, req.body);
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(categories)
          .values({
            outletId: principal.outletId,
            name: body.name,
            sortOrder: body.sort_order ?? 0,
            createdAt: ctx.now(),
          })
          .returning();
        if (!row) throw new Error('failed to create category');
        await writeAudit(tx, {
          outletId: principal.outletId,
          actor: { type: 'user', id: principal.id },
          action: 'category.created',
          entityType: 'category',
          entityId: row.id,
          after: { name: row.name, sort_order: row.sortOrder },
        });
        return row;
      });
      return reply.status(201).send(toCategory(created));
    });

    app.patch('/categories/:category_id', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const { category_id: id } = parse(categoryId, req.params);
      const body = parse(categoryUpdate, req.body);
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(categories)
          .where(
            and(
              eq(categories.id, id),
              eq(categories.outletId, principal.outletId),
              isNull(categories.deletedAt),
            ),
          )
          .for('update');
        if (!current) throw errors.notFound('Category not found');
        const [row] = await tx
          .update(categories)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.sort_order !== undefined ? { sortOrder: body.sort_order } : {}),
          })
          .where(eq(categories.id, id))
          .returning();
        if (!row) throw new Error('failed to update category');
        await writeAudit(tx, {
          outletId: principal.outletId,
          actor: { type: 'user', id: principal.id },
          action: 'category.updated',
          entityType: 'category',
          entityId: id,
          before: { name: current.name, sort_order: current.sortOrder },
          after: { name: row.name, sort_order: row.sortOrder },
        });
        return toCategory(row);
      });
    });

    app.delete('/categories/:category_id', { preHandler: guards.owner }, async (req, reply) => {
      const principal = requireUser(req);
      const { category_id: id } = parse(categoryId, req.params);
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(categories)
          .where(
            and(
              eq(categories.id, id),
              eq(categories.outletId, principal.outletId),
              isNull(categories.deletedAt),
            ),
          )
          .for('update');
        if (!current) throw errors.notFound('Category not found');
        const [usage] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(products)
          .where(and(eq(products.categoryId, id), isNull(products.deletedAt)));
        if ((usage?.n ?? 0) > 0) {
          throw errors.conflict(
            'CATEGORY_NOT_EMPTY',
            'Category still has products',
            `${usage?.n} product(s) still use this category; move or delete them first`,
          );
        }
        await tx.update(categories).set({ deletedAt: ctx.now() }).where(eq(categories.id, id));
        await writeAudit(tx, {
          outletId: principal.outletId,
          actor: { type: 'user', id: principal.id },
          action: 'category.deleted',
          entityType: 'category',
          entityId: id,
          before: { name: current.name },
        });
      });
      return reply.status(204).send();
    });

    // ------------------------------------------------------------ products
    app.get('/products', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const q = parse(listProductsQuery, req.query);
      const conditions = [eq(products.outletId, principal.outletId), isNull(products.deletedAt)];
      if (q.category_id) conditions.push(eq(products.categoryId, q.category_id));
      if (q.is_active) conditions.push(eq(products.isActive, q.is_active === 'true'));
      if (q.q) conditions.push(ilike(products.name, `%${escapeLike(q.q)}%`));
      const rows = await db
        .select()
        .from(products)
        .where(and(...conditions))
        .orderBy(asc(products.sortOrder), asc(products.name));
      return { data: rows.map(toProduct) };
    });

    app.post('/products', { preHandler: guards.owner }, async (req, reply) => {
      const principal = requireUser(req);
      const body = parse(productCreate, req.body);
      const created = await db.transaction(async (tx) => {
        await requireCategory(tx, principal.outletId, body.category_id);
        const [row] = await tx
          .insert(products)
          .values({
            outletId: principal.outletId,
            categoryId: body.category_id,
            name: body.name,
            imageUrl: body.image_url ?? null,
            price: body.price,
            isActive: body.is_active ?? true,
            isFavorite: body.is_favorite ?? false,
            sortOrder: body.sort_order ?? 0,
            createdAt: ctx.now(),
          })
          .returning();
        if (!row) throw new Error('failed to create product');
        await writeAudit(tx, {
          outletId: principal.outletId,
          actor: { type: 'user', id: principal.id },
          action: 'product.created',
          entityType: 'product',
          entityId: row.id,
          after: { name: row.name, price: row.price, category_id: row.categoryId },
        });
        return row;
      });
      return reply.status(201).send(toProduct(created));
    });

    app.get('/products/:product_id', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const { product_id: id } = parse(productId, req.params);
      return toProduct(await findProduct(db, principal.outletId, id));
    });

    app.patch('/products/:product_id', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      const { product_id: id } = parse(productId, req.params);
      const body = parse(productUpdate, req.body);
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(products)
          .where(
            and(
              eq(products.id, id),
              eq(products.outletId, principal.outletId),
              isNull(products.deletedAt),
            ),
          )
          .for('update');
        if (!current) throw errors.notFound('Product not found');
        if (body.category_id && body.category_id !== current.categoryId) {
          await requireCategory(tx, principal.outletId, body.category_id);
        }
        const [row] = await tx
          .update(products)
          .set({
            ...(body.category_id !== undefined ? { categoryId: body.category_id } : {}),
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.image_url !== undefined ? { imageUrl: body.image_url } : {}),
            ...(body.price !== undefined ? { price: body.price } : {}),
            ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
            ...(body.is_favorite !== undefined ? { isFavorite: body.is_favorite } : {}),
            ...(body.sort_order !== undefined ? { sortOrder: body.sort_order } : {}),
          })
          .where(eq(products.id, id))
          .returning();
        if (!row) throw new Error('failed to update product');
        const actor = { type: 'user', id: principal.id } as const;
        if (row.price !== current.price) {
          await writeAudit(tx, {
            outletId: principal.outletId,
            actor,
            action: 'product.price_changed',
            entityType: 'product',
            entityId: id,
            before: { price: current.price },
            after: { price: row.price },
            meta: { name: row.name },
          });
        }
        const otherChanges =
          row.name !== current.name ||
          row.categoryId !== current.categoryId ||
          row.imageUrl !== current.imageUrl ||
          row.isActive !== current.isActive ||
          row.isFavorite !== current.isFavorite ||
          row.sortOrder !== current.sortOrder;
        if (otherChanges) {
          await writeAudit(tx, {
            outletId: principal.outletId,
            actor,
            action: 'product.updated',
            entityType: 'product',
            entityId: id,
            before: {
              name: current.name,
              category_id: current.categoryId,
              is_active: current.isActive,
              is_favorite: current.isFavorite,
              sort_order: current.sortOrder,
            },
            after: {
              name: row.name,
              category_id: row.categoryId,
              is_active: row.isActive,
              is_favorite: row.isFavorite,
              sort_order: row.sortOrder,
            },
          });
        }
        return toProduct(row);
      });
    });

    app.delete('/products/:product_id', { preHandler: guards.owner }, async (req, reply) => {
      const principal = requireUser(req);
      const { product_id: id } = parse(productId, req.params);
      await db.transaction(async (tx) => {
        const current = await findProduct(tx, principal.outletId, id);
        await tx.update(products).set({ deletedAt: ctx.now() }).where(eq(products.id, id));
        await writeAudit(tx, {
          outletId: principal.outletId,
          actor: { type: 'user', id: principal.id },
          action: 'product.deleted',
          entityType: 'product',
          entityId: id,
          before: { name: current.name, price: current.price },
        });
      });
      return reply.status(204).send();
    });

    app.patch(
      '/products/:product_id/availability',
      { preHandler: guards.ownerOrEmployee },
      async (req) => {
        const principal = req.principal;
        if (!principal) throw errors.unauthorized();
        const { product_id: id } = parse(productId, req.params);
        const body = parse(z.object({ is_sold_out: z.boolean() }), req.body);
        const result = await db.transaction((tx) =>
          setSoldOut(tx, {
            outletId: principal.outletId,
            productId: id,
            isSoldOut: body.is_sold_out,
            actor: { type: principal.type, id: principal.id },
            source: 'api',
          }),
        );
        if (!result) throw errors.notFound('Product not found');
        return toProduct(result.product);
      },
    );
  };
}
