import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { errors } from '../../errors.js';
import { parse, uuid } from '../../lib/validate.js';
import { requireUser, type Guards } from '../../plugins/auth.js';
import { deleteInput, discountInput, discountUpdate, listQuery } from './rules.js';
import { DiscountService } from './service.js';

const params = z.object({ discount_id: uuid });
const optionsQuery = z.object({ outlet_scope: z.enum(['current', 'all']).default('current') });

/**
 * Item discounts of the dashboard "Diskon" menu (ADR-0023 §6). The owner writes; a manager only reads the discounts of
 * their outlet; cashier and device tokens never reach these routes (the `owner` guard answers 403/401).
 */
export function discountRoutes(ctx: AppContext, guards: Guards) {
  const service = new DiscountService(ctx.db, ctx.now, ctx.config.discountMinAppVersion);

  const ownerRole: preHandlerAsyncHookHandler = async (req) => {
    if (req.principal?.type !== 'user' || req.principal.role !== 'owner') {
      throw errors.forbidden('Only the owner can do this');
    }
  };
  const ownerOnly = [guards.owner, ownerRole];

  return async (app: FastifyInstance): Promise<void> => {
    app.get('/discounts', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      return service.list(principal, parse(listQuery, req.query));
    });

    app.post('/discounts', { preHandler: ownerOnly }, async (req, reply) => {
      const principal = requireUser(req);
      const created = await service.create(
        { principal, ip: req.ip },
        parse(discountInput, req.body),
      );
      return reply.status(201).send(created);
    });

    // Registered before `/discounts/:discount_id`; the static path wins either way.
    app.get('/discounts/target-options', { preHandler: ownerOnly }, async (req) => {
      const principal = requireUser(req);
      return service.targetOptions(principal, parse(optionsQuery, req.query).outlet_scope);
    });

    app.get('/discounts/:discount_id', { preHandler: guards.owner }, async (req) => {
      const principal = requireUser(req);
      return service.get(principal, parse(params, req.params).discount_id);
    });

    app.patch('/discounts/:discount_id', { preHandler: ownerOnly }, async (req) => {
      const principal = requireUser(req);
      const { discount_id: id } = parse(params, req.params);
      return service.update({ principal, ip: req.ip }, id, parse(discountUpdate, req.body));
    });

    app.delete('/discounts/:discount_id', { preHandler: ownerOnly }, async (req) => {
      const principal = requireUser(req);
      const { discount_id: id } = parse(params, req.params);
      const body = parse(deleteInput, req.body);
      return service.remove({ principal, ip: req.ip }, id, body.reason);
    });
  };
}
