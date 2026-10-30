import { createHash } from 'node:crypto';
import multipart from '@fastify/multipart';
import { PRODUCT_IMPORT_LIMITS } from '@kelola-kasir/contracts';
import type { ProductImportPreview, ProductImportResult } from '@kelola-kasir/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../../context.js';
import type { DbOrTx } from '../../../db/client.js';
import { auditLogs, categories, products } from '../../../db/schema.js';
import { errors } from '../../../errors.js';
import { clientIp } from '../../../lib/client-ip.js';
import { sha256Hex } from '../../../lib/crypto.js';
import { parse } from '../../../lib/validate.js';
import { requireUser, type Guards } from '../../../plugins/auth.js';
import { writeAudit } from '../../audit/audit.js';
import { importErrors, parseImportFile, type ParsedImportFile } from './file.js';
import { buildPlan, type ImportPlan, type PlanRow } from './plan.js';
import { buildCsvTemplate, buildXlsxTemplate, TEMPLATE_BASENAME } from './template.js';
import { issueImportToken, verifyImportToken } from './token.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const templateQuery = z.object({ format: z.enum(['xlsx', 'csv']) });
/** Multipart overhead on top of the file itself. */
const BODY_LIMIT = PRODUCT_IMPORT_LIMITS.maxBytes + 64 * 1024;

interface Upload {
  fileName: string;
  buffer: Buffer;
  token: string | null;
}

interface Catalog {
  products: Parameters<typeof buildPlan>[1];
  categories: Parameters<typeof buildPlan>[2];
  categoryNames: Map<string, string>;
  seq: number;
}

async function readUpload(req: FastifyRequest, wantToken: boolean): Promise<Upload> {
  if (!req.isMultipart()) throw importErrors.unsupported();
  let file: { fileName: string; buffer: Buffer } | null = null;
  let token: string | null = null;
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        if (part.fieldname === 'file' && !file) file = { fileName: part.filename, buffer };
      } else if (part.fieldname === 'import_token' && typeof part.value === 'string') {
        token = part.value;
      }
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') throw importErrors.tooLarge();
    if (code?.startsWith('FST_')) {
      throw errors.validation([{ path: 'file', message: 'Permintaan upload tidak valid' }]);
    }
    throw err;
  }
  if (!file) throw errors.validation([{ path: 'file', message: 'File wajib diunggah' }]);
  if (wantToken && (!token || token.length > 200)) {
    throw errors.validation([{ path: 'import_token', message: 'import_token wajib diisi' }]);
  }
  return { ...file, token: wantToken ? token : null };
}

/** Highest `updated_seq` of the outlet's categories and products, soft-deleted rows included. */
async function catalogSeq(tx: DbOrTx, outletId: string): Promise<number> {
  const result = await tx.execute<{ seq: string }>(sql`
    select greatest(
      coalesce((select max(updated_seq) from categories where outlet_id = ${outletId}), 0),
      coalesce((select max(updated_seq) from products where outlet_id = ${outletId}), 0)
    )::text as seq`);
  return Number(result.rows[0]?.seq ?? 0);
}

async function loadCatalog(tx: DbOrTx, outletId: string): Promise<Catalog> {
  const [prods, cats, seq] = await Promise.all([
    tx
      .select({
        id: products.id,
        name: products.name,
        categoryId: products.categoryId,
        price: products.price,
        isFavorite: products.isFavorite,
        isActive: products.isActive,
      })
      .from(products)
      .where(and(eq(products.outletId, outletId), isNull(products.deletedAt))),
    tx
      .select({ id: categories.id, name: categories.name, deletedAt: categories.deletedAt })
      .from(categories)
      .where(eq(categories.outletId, outletId))
      .orderBy(asc(categories.sortOrder), asc(categories.createdAt), asc(categories.id)),
    catalogSeq(tx, outletId),
  ]);
  return {
    products: prods,
    categories: cats.filter((c) => c.deletedAt === null).map(({ id, name }) => ({ id, name })),
    categoryNames: new Map(cats.map((c) => [c.id, c.name])),
    seq,
  };
}

const planOf = (parsed: ParsedImportFile, catalog: Catalog): ImportPlan =>
  buildPlan(parsed.rows, catalog.products, catalog.categories, catalog.categoryNames);

function toPreviewRow(r: PlanRow): ProductImportPreview['rows'][number] {
  return {
    row: r.row,
    action: r.action,
    name: r.name,
    category: r.category,
    price: r.price,
    is_favorite: r.is_favorite,
    is_active: r.is_active,
    product_id: r.product_id,
    category_is_new: r.category_is_new,
    changes: r.changes,
    errors: r.errors,
  };
}

export function productImportRoutes(ctx: AppContext, guards: Guards) {
  const { db, config } = ctx;
  const secret = config.pinFingerprintSecret;

  return async (app: FastifyInstance): Promise<void> => {
    // 20/min per session, shared by preview and commit through one limiter (one counter store). It runs
    // before auth, so the hashed bearer token stands in for the user and the client IP covers the rest.
    const limiter = app.rateLimit({
      max: config.rateLimit.importMax ?? 20,
      timeWindow: '1 minute',
      keyGenerator: (req: FastifyRequest) =>
        req.headers.authorization
          ? `t:${sha256Hex(req.headers.authorization)}`
          : `ip:${clientIp(config, req)}`,
    });
    await app.register(multipart, {
      limits: { files: 1, fields: 2, parts: 4, fileSize: PRODUCT_IMPORT_LIMITS.maxBytes },
    });

    app.get('/products/import/template', { preHandler: guards.owner }, async (req, reply) => {
      const { format } = parse(templateQuery, req.query);
      const body = format === 'xlsx' ? await buildXlsxTemplate() : buildCsvTemplate();
      return reply
        .header('content-type', format === 'xlsx' ? XLSX_TYPE : 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${TEMPLATE_BASENAME}.${format}"`)
        .header('cache-control', 'no-store')
        .send(body);
    });

    app.post(
      '/products/import/preview',
      { onRequest: limiter, preHandler: guards.owner, bodyLimit: BODY_LIMIT },
      async (req): Promise<ProductImportPreview> => {
        const principal = requireUser(req);
        const upload = await readUpload(req, false);
        const parsed = await parseImportFile(upload.fileName, upload.buffer);
        const fileSha256 = createHash('sha256').update(upload.buffer).digest('hex');
        const catalog = await loadCatalog(db, principal.outletId);
        const plan = planOf(parsed, catalog);
        req.log.info(
          { bytes: upload.buffer.length, format: parsed.format, rows: plan.summary.total },
          'product import preview',
        );
        const { summary } = plan;
        const issue =
          summary.error === 0 && summary.create + summary.update > 0
            ? issueImportToken(
                secret,
                { outletId: principal.outletId, userId: principal.id, fileSha256 },
                catalog.seq,
                ctx.now(),
              )
            : null;
        return {
          format: parsed.format,
          file_sha256: fileSha256,
          summary,
          new_categories: plan.newCategories,
          rows: plan.rows.map(toPreviewRow),
          warnings: parsed.warnings,
          import_token: issue?.token ?? null,
          expires_at: issue?.expiresAt.toISOString() ?? null,
        };
      },
    );

    app.post(
      '/products/import/commit',
      { onRequest: limiter, preHandler: guards.owner, bodyLimit: BODY_LIMIT },
      async (req): Promise<ProductImportResult> => {
        const principal = requireUser(req);
        const { outletId } = principal;
        const upload = await readUpload(req, true);
        const parsed = await parseImportFile(upload.fileName, upload.buffer);
        const fileSha256 = createHash('sha256').update(upload.buffer).digest('hex');

        // Cheap pre-checks outside the transaction; everything is repeated under the lock below.
        const early = planOf(parsed, await loadCatalog(db, outletId));
        if (early.summary.error > 0) throw hasErrors();
        const verified = verifyImportToken(
          secret,
          { outletId, userId: principal.id, fileSha256 },
          upload.token ?? '',
        );
        if (!verified) {
          throw errors.badRequest(
            'IMPORT_TOKEN_INVALID',
            'Token impor tidak valid',
            'Token tidak cocok dengan file ini. Unggah file lagi untuk mendapat pratinjau baru.',
          );
        }
        if (verified.expiresAt * 1000 <= ctx.now().getTime()) throw stale();

        const result = await db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`product-import:${outletId}`}))`,
          );
          const catalog = await loadCatalog(tx, outletId);
          if (catalog.seq !== verified.catalogSeq) throw stale();
          const plan = planOf(parsed, catalog);
          if (plan.summary.error > 0) throw hasErrors();
          return applyPlan(tx, plan, {
            outletId,
            userId: principal.id,
            fileSha256,
            format: parsed.format,
            now: ctx.now(),
          });
        });
        req.log.info(
          { bytes: upload.buffer.length, format: parsed.format, rows: parsed.rows.length },
          'product import committed',
        );
        return result;
      },
    );
  };
}

const hasErrors = () =>
  errors.unprocessable(
    'IMPORT_HAS_ERRORS',
    'File masih berisi baris yang salah',
    'Tidak ada produk yang disimpan. Perbaiki baris yang salah lalu unggah lagi.',
  );

const stale = () =>
  errors.conflict(
    'IMPORT_STALE',
    'Katalog berubah',
    'Katalog berubah sejak pratinjau. Unggah ulang untuk melihat pratinjau terbaru.',
  );

interface ApplyContext {
  outletId: string;
  userId: string;
  fileSha256: string;
  format: 'csv' | 'xlsx';
  now: Date;
}

/** Create categories, insert and update products in batches, then write the audit trail (ADR-0018 §7). */
async function applyPlan(
  tx: DbOrTx,
  plan: ImportPlan,
  c: ApplyContext,
): Promise<ProductImportResult> {
  const categoryIds = new Map<string, string>();
  if (plan.newCategories.length > 0) {
    const created = await tx
      .insert(categories)
      .values(
        plan.newCategories.map((name) => ({
          outletId: c.outletId,
          name,
          sortOrder: 0,
          createdAt: c.now,
        })),
      )
      .returning({ id: categories.id, name: categories.name });
    for (const row of created) categoryIds.set(row.name.toLowerCase(), row.id);
  }
  const categoryOf = (r: PlanRow): string => {
    const id = r.categoryId ?? categoryIds.get(r.categoryKey ?? '');
    if (!id) throw new Error('import plan references an unknown category');
    return id;
  };

  const creates = plan.rows.filter((r) => r.action === 'create');
  if (creates.length > 0) {
    await tx.insert(products).values(
      creates.map((r) => ({
        outletId: c.outletId,
        categoryId: categoryOf(r),
        name: r.name ?? '',
        price: r.price ?? 0,
        isActive: r.is_active ?? true,
        isFavorite: r.is_favorite ?? false,
        sortOrder: 0,
        createdAt: c.now,
      })),
    );
  }

  const updates = plan.rows.filter((r) => r.action === 'update');
  if (updates.length > 0) {
    const values = sql.join(
      updates.map(
        (r) =>
          sql`(${r.product_id}::uuid, ${r.price}::bigint, ${categoryOf(r)}::uuid, ${r.is_favorite}::boolean, ${r.is_active}::boolean)`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      update products p
         set price = v.price, category_id = v.category_id, is_favorite = v.is_favorite, is_active = v.is_active
        from (values ${values}) as v(id, price, category_id, is_favorite, is_active)
       where p.id = v.id and p.outlet_id = ${c.outletId}`);
  }

  const unchanged = plan.summary.unchanged;
  await writeAudit(tx, {
    outletId: c.outletId,
    actor: { type: 'user', id: c.userId },
    action: 'product.imported',
    entityType: 'product_import',
    meta: {
      file_sha256: c.fileSha256,
      format: c.format,
      rows: plan.summary.total,
      created: creates.length,
      updated: updates.length,
      unchanged,
      categories_created: plan.newCategories.length,
    },
  });
  const priceChanges = updates.filter((r) => r.changes.some((ch) => ch.field === 'price'));
  if (priceChanges.length > 0) {
    await tx.insert(auditLogs).values(
      priceChanges.map((r) => ({
        outletId: c.outletId,
        actorType: 'user' as const,
        actorId: c.userId,
        action: 'product.price_changed',
        entityType: 'product',
        entityId: r.product_id,
        before: { price: r.priceBefore },
        after: { price: r.price },
        meta: { name: r.name, source: 'import' },
      })),
    );
  }
  return {
    created: creates.length,
    updated: updates.length,
    unchanged,
    categories_created: plan.newCategories.length,
  };
}
