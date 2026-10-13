import { z } from 'zod';
import { IdSchema, RevisionSchema } from './primitives';

export const ErrorCodeSchema = z.enum([
  'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'PAYLOAD_TOO_LARGE',
  'VALIDATION_FAILED', 'RATE_LIMITED', 'PROVIDER_FAILED', 'UNAVAILABLE', 'INTERNAL_ERROR',
]);
export const ErrorEnvelopeSchema = z.strictObject({
  code: ErrorCodeSchema,
  messageKey: z.string().regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+$/),
  fieldErrors: z.record(z.string().max(128), z.array(z.string().max(160))).optional(),
  retryable: z.boolean(),
  requestId: IdSchema,
  currentRevision: RevisionSchema.optional(),
  recovery: z.enum(['sign-in', 'retry', 'reload', 'resolve-conflict', 'contact-owner']).optional(),
});
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413, VALIDATION_FAILED: 422, RATE_LIMITED: 429,
  PROVIDER_FAILED: 502, UNAVAILABLE: 503, INTERNAL_ERROR: 500,
};
