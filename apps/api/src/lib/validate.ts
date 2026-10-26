import type { z } from 'zod';
import { errors } from '../errors.js';

/** Parse `input` with a Zod schema; failures become a `VALIDATION_ERROR` problem. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw errors.validation(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/** Any 8-4-4-4-12 hex UUID; matches OpenAPI `format: uuid`, which does not enforce RFC 4122 version/variant bits. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
