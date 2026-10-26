import { z } from 'zod';
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

/** Escape `%`, `_` and `\` so user input can be used inside a LIKE pattern. */
export const escapeLike = (input: string): string => input.replace(/[\\%_]/g, (c) => `\\${c}`);

/** UUID schema matching OpenAPI `format: uuid` (see `UUID_PATTERN`). */
export const uuid = z.string().regex(UUID_PATTERN, 'Invalid UUID');

const MIN_TIMESTAMP_MS = Date.UTC(2020, 0, 1);
const MAX_TIMESTAMP_MS = Date.UTC(2100, 0, 1);

/** ISO 8601 timestamp with offset, parsed to a `Date` and limited to 2020-2099 so it always serialises. */
export const isoTimestamp = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v))
  .refine(
    (d) => d.getTime() >= MIN_TIMESTAMP_MS && d.getTime() < MAX_TIMESTAMP_MS,
    'Timestamp is out of the supported range (2020-2099)',
  );

/** Business date `yyyy-mm-dd`, limited to 1970-2099 so range queries never hit a database date overflow. */
export const isoDate = z.iso
  .date()
  .refine(
    (v) => Date.parse(v) >= 0 && Date.parse(v) < MAX_TIMESTAMP_MS,
    'Date is out of the supported range (1970-2099)',
  );
