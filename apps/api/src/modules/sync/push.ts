import { z } from 'zod';
import { isoTimestamp, uuid } from '../../lib/validate.js';
import type { AppContext } from '../../context.js';
import { AppError } from '../../errors.js';
import { setSoldOut } from '../catalog/availability.js';
import { closeBodySchema, closeShift } from '../shifts/close.js';
import { requestVoid, voidReasonSchema } from '../voids/service.js';
import { createTransaction, transactionCreateSchema } from '../transactions/service.js';

export const MAX_MUTATIONS = 50;

export const pushBodySchema = z.object({
  mutations: z
    .array(
      z.object({
        id: uuid,
        // Unknown types are rejected per mutation, not by failing the whole batch.
        type: z.string().max(60),
        client_created_at: isoTimestamp,
        employee_id: uuid.optional(),
        payload: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(MAX_MUTATIONS),
});

export type Mutation = z.output<typeof pushBodySchema>['mutations'][number];

export interface MutationResult {
  id: string;
  status: 'applied' | 'duplicate' | 'rejected';
  code?: string;
  detail?: string;
}

export interface PushDevice {
  id: string;
  code: string;
  outletId: string;
}

const shiftCloseSchema = closeBodySchema.extend({ shift_id: uuid });
const voidRequestSchema = z.object({ transaction_id: uuid, reason: voidReasonSchema });
const soldOutSchema = z.object({ product_id: uuid, is_sold_out: z.boolean() });

const reject = (id: string, code: string, detail: string): MutationResult => ({
  id,
  status: 'rejected',
  code,
  detail,
});

function schemaProblem(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(payload)'}: ${i.message}`).join('; ');
}

async function apply(
  ctx: AppContext,
  device: PushDevice,
  m: Mutation,
  ip: string | undefined,
): Promise<MutationResult> {
  switch (m.type) {
    case 'transaction.create': {
      if (!m.employee_id) return reject(m.id, 'EMPLOYEE_REQUIRED', 'employee_id is required');
      const parsed = transactionCreateSchema.safeParse(m.payload);
      if (!parsed.success) return reject(m.id, 'VALIDATION_ERROR', schemaProblem(parsed.error));
      if (parsed.data.id !== m.id) {
        return reject(m.id, 'ID_MISMATCH', 'Mutation id must equal the transaction id');
      }
      const result = await createTransaction(ctx, parsed.data, {
        outletId: device.outletId,
        device: { id: device.id, code: device.code },
        employeeId: m.employee_id,
        source: 'sync',
        ...(ip ? { ip } : {}),
      });
      return { id: m.id, status: result.created ? 'applied' : 'duplicate' };
    }
    case 'shift.close': {
      if (!m.employee_id) return reject(m.id, 'EMPLOYEE_REQUIRED', 'employee_id is required');
      const parsed = shiftCloseSchema.safeParse(m.payload);
      if (!parsed.success) return reject(m.id, 'VALIDATION_ERROR', schemaProblem(parsed.error));
      if (parsed.data.shift_id !== m.id) {
        return reject(m.id, 'ID_MISMATCH', 'Mutation id must equal the shift id');
      }
      const { shift_id: shiftId, ...body } = parsed.data;
      const result = await closeShift(
        ctx,
        { employeeId: m.employee_id, deviceId: device.id, outletId: device.outletId },
        shiftId,
        body,
        ip,
      );
      return { id: m.id, status: result.replayed ? 'duplicate' : 'applied' };
    }
    case 'product.mark_sold_out': {
      const parsed = soldOutSchema.safeParse(m.payload);
      if (!parsed.success) return reject(m.id, 'VALIDATION_ERROR', schemaProblem(parsed.error));
      const result = await ctx.db.transaction((tx) =>
        setSoldOut(tx, {
          outletId: device.outletId,
          productId: parsed.data.product_id,
          isSoldOut: parsed.data.is_sold_out,
          actor: m.employee_id
            ? { type: 'employee', id: m.employee_id }
            : { type: 'device', id: device.id },
          source: 'sync',
        }),
      );
      if (!result) return reject(m.id, 'NOT_FOUND', 'Product not found');
      return { id: m.id, status: result.changed ? 'applied' : 'duplicate' };
    }
    case 'void_request.create': {
      if (!m.employee_id) return reject(m.id, 'EMPLOYEE_REQUIRED', 'employee_id is required');
      const parsed = voidRequestSchema.safeParse(m.payload);
      if (!parsed.success) return reject(m.id, 'VALIDATION_ERROR', schemaProblem(parsed.error));
      const result = await requestVoid(
        ctx,
        {
          outletId: device.outletId,
          employeeId: m.employee_id,
          deviceId: device.id,
          source: 'sync',
          ...(ip ? { ip } : {}),
        },
        parsed.data.transaction_id,
        { id: m.id, reason: parsed.data.reason, requestedAt: m.client_created_at },
      );
      return { id: m.id, status: result.created ? 'applied' : 'duplicate' };
    }
    default:
      return reject(m.id, 'UNKNOWN_MUTATION', `Unknown mutation type "${m.type}"`);
  }
}

/**
 * Apply queued offline mutations in order, each in its own database transaction. A mutation that
 * fails business validation is `rejected` and does not stop the others; replays are `duplicate`.
 */
export async function pushMutations(
  ctx: AppContext,
  device: PushDevice,
  mutations: Mutation[],
  ip: string | undefined,
): Promise<MutationResult[]> {
  const results: MutationResult[] = [];
  for (const mutation of mutations) {
    try {
      results.push(await apply(ctx, device, mutation, ip));
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      results.push(
        reject(
          mutation.id,
          err.code,
          err.errors?.map((e) => `${e.path}: ${e.message}`).join('; ') ?? err.detail ?? err.title,
        ),
      );
    }
  }
  return results;
}
