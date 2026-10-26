import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { errors } from '../../errors.js';
import { parse, uuid } from '../../lib/validate.js';
import { requireEmployee, type Guards } from '../../plugins/auth.js';
import { loadSettings } from '../settings/serialize.js';
import { toPayment } from './serialize.js';
import { loadTransactionOf, type PaymentService } from './service.js';
import { clientIp } from '../../lib/client-ip.js';

const idParams = z.object({ payment_id: uuid });

export function paymentRoutes(ctx: AppContext, guards: Guards, service: PaymentService) {
  const { db } = ctx;

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/payments/:payment_id', { preHandler: guards.ownerOrEmployee }, async (req) => {
      const principal = req.principal;
      if (!principal) throw errors.unauthorized();
      const { payment_id: id } = parse(idParams, req.params);
      const payment = await service.get(principal.outletId, id);
      const qrImageUrl =
        payment.provider === 'qris_static'
          ? (await loadSettings(db, principal.outletId)).settings.qrisStaticImageUrl
          : null;
      return toPayment(payment, qrImageUrl);
    });

    app.post('/payments/:payment_id/confirm', { preHandler: guards.employee }, async (req) => {
      const principal = requireEmployee(req);
      const { payment_id: id } = parse(idParams, req.params);
      const transactionId = await service.confirm(
        principal.outletId,
        id,
        principal.id,
        clientIp(ctx.config, req),
      );
      return loadTransactionOf(db, transactionId);
    });

    app.post('/payments/:payment_id/cancel', { preHandler: guards.employee }, async (req) => {
      const principal = requireEmployee(req);
      const { payment_id: id } = parse(idParams, req.params);
      const transactionId = await service.cancel(principal.outletId, id, principal.id);
      return loadTransactionOf(db, transactionId);
    });
  };
}
