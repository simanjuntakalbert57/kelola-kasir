export interface FieldError {
  path: string;
  message: string;
}

/** Error that is rendered as an RFC 9457 `application/problem+json` response. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: FieldError[],
    readonly headers?: Record<string, string>,
  ) {
    super(detail ?? title);
    this.name = 'AppError';
  }
}

export const errors = {
  validation: (fieldErrors: FieldError[], detail = 'Request validation failed') =>
    new AppError(400, 'VALIDATION_ERROR', 'Validation error', detail, fieldErrors),
  badRequest: (code: string, title: string, detail?: string) =>
    new AppError(400, code, title, detail),
  unauthorized: (detail = 'Missing or invalid credentials', code = 'UNAUTHORIZED') =>
    new AppError(401, code, 'Unauthorized', detail),
  forbidden: (detail = 'You are not allowed to perform this action') =>
    new AppError(403, 'FORBIDDEN', 'Forbidden', detail),
  notFound: (detail = 'Resource not found', code = 'NOT_FOUND') =>
    new AppError(404, code, 'Not found', detail),
  conflict: (code: string, title: string, detail?: string) =>
    new AppError(409, code, title, detail),
  unprocessable: (code: string, title: string, detail?: string) =>
    new AppError(422, code, title, detail),
  unavailable: (code: string, title: string, detail?: string) =>
    new AppError(503, code, title, detail),
  locked: (code: string, detail: string, retryAfterSec: number) =>
    new AppError(423, code, 'Locked', detail, undefined, { 'Retry-After': String(retryAfterSec) }),
  tooManyRequests: (code: string, detail: string, retryAfterSec: number) =>
    new AppError(429, code, 'Too many requests', detail, undefined, {
      'Retry-After': String(retryAfterSec),
    }),
};
