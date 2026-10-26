import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';

const PROBLEM_BASE = 'https://kelolakasir.example/problems/';
const CONTENT_TYPE = 'application/problem+json; charset=utf-8';

function send(
  reply: FastifyReply,
  req: FastifyRequest,
  status: number,
  code: string,
  title: string,
  detail?: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
): FastifyReply {
  void reply.header('content-type', CONTENT_TYPE);
  if (headers) for (const [k, v] of Object.entries(headers)) void reply.header(k, v);
  return reply.status(status).send({
    type: `${PROBLEM_BASE}${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    ...(detail ? { detail } : {}),
    instance: req.url.split('?')[0],
    ...extra,
  });
}

/** Render every error as `application/problem+json` with a stable `code` (TDD §4). */
export function registerProblemHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, req, reply) => {
    if (error instanceof AppError) {
      return send(
        reply,
        req,
        error.status,
        error.code,
        error.title,
        error.detail,
        error.errors ? { errors: error.errors } : undefined,
        error.headers,
      );
    }
    const status = error.statusCode ?? 500;
    if (status === 429) {
      return send(
        reply,
        req,
        429,
        'RATE_LIMITED',
        'Too many requests',
        'Rate limit exceeded, retry later',
      );
    }
    if (status === 415) {
      return send(
        reply,
        req,
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Unsupported media type',
        'Use application/json',
      );
    }
    if (status >= 400 && status < 500) {
      return send(reply, req, 400, 'VALIDATION_ERROR', 'Bad request', 'Malformed request');
    }
    req.log.error({ err: error }, 'unhandled error');
    return send(reply, req, 500, 'INTERNAL_ERROR', 'Internal server error');
  });

  app.setNotFoundHandler((req, reply) =>
    send(
      reply,
      req,
      404,
      'NOT_FOUND',
      'Not found',
      `Route ${req.method} ${req.url.split('?')[0]} does not exist`,
    ),
  );
}
