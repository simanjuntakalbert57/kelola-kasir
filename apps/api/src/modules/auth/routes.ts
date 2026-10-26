import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { errors } from '../../errors.js';
import { parse, UUID_PATTERN } from '../../lib/validate.js';
import { requireEmployee, requireUser, type Guards } from '../../plugins/auth.js';
import { OwnerAuthService } from './owner-service.js';
import { PinAuthService } from './pin-service.js';

const REFRESH_COOKIE = 'kk_refresh';

const loginBody = z.object({ email: z.string().min(3).max(254).regex(/^[^@\s]+@[^@\s]+$/, 'Invalid email'), password: z.string().min(8).max(200) });
const pinLoginBody = z.object({
  employee_id: z.string().regex(UUID_PATTERN, 'Invalid UUID'),
  pin: z.string().regex(/^[0-9]{6}$/, 'PIN must be 6 digits'),
});

export function authRoutes(ctx: AppContext, guards: Guards) {
  const owner = new OwnerAuthService(ctx);
  const pin = new PinAuthService(ctx);

  return async (app: FastifyInstance): Promise<void> => {
    const refreshCookieOptions = {
      httpOnly: true,
      secure: ctx.config.cookieSecure,
      sameSite: 'strict' as const,
      path: '/v1/auth',
    };

    app.post(
      '/auth/login',
      {
        config: {
          rateLimit: { max: ctx.config.rateLimit.loginMax, timeWindow: '1 minute' },
        },
      },
      async (req, reply) => {
        const body = parse(loginBody, req.body);
        const result = await owner.login(body.email, body.password, req.ip);
        void reply.setCookie(REFRESH_COOKIE, result.refreshToken, {
          ...refreshCookieOptions,
          maxAge: ctx.config.refreshTtlSec,
        });
        return result.session;
      },
    );

    app.post('/auth/refresh', async (req, reply) => {
      const result = await owner.refresh(req.cookies[REFRESH_COOKIE]);
      void reply.setCookie(REFRESH_COOKIE, result.refreshToken, {
        ...refreshCookieOptions,
        maxAge: ctx.config.refreshTtlSec,
      });
      return result.session;
    });

    app.post('/auth/logout', { preHandler: guards.owner }, async (req, reply) => {
      const principal = requireUser(req);
      await owner.logout(principal.id, req.cookies[REFRESH_COOKIE]);
      void reply.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
      return reply.status(204).send();
    });

    app.post('/auth/pin-login', { preHandler: guards.device }, async (req) => {
      const body = parse(pinLoginBody, req.body);
      const device = req.device;
      if (!device) throw errors.unauthorized();
      return pin.login(device, body.employee_id, body.pin, req.ip);
    });

    app.post('/auth/pin-logout', { preHandler: guards.employee }, async (req, reply) => {
      const principal = requireEmployee(req);
      await pin.logout(principal.sessionId);
      return reply.status(204).send();
    });

    app.get('/me', { preHandler: guards.ownerOrEmployee }, async (req) => {
      const principal = req.principal;
      if (!principal) throw errors.unauthorized();
      return {
        type: principal.type,
        id: principal.id,
        name: principal.name,
        role: principal.role,
        outlet_id: principal.outletId,
        device_id: principal.type === 'employee' ? principal.deviceId : null,
      };
    });
  };
}
