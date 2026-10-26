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

/** Escape `%`, `_` and `\` so user input can be used inside a LIKE pattern. */
export const escapeLike = (input: string): string => input.replace(/[\\%_]/g, (c) => `\\${c}`);
