import type { Pool } from 'pg';
import { z } from 'zod';
import { ApplyPreparedCalculationRequestSchema, PrepareCalculationRequestSchema } from '@/contracts/calculations';
import { artifactErrorResponse, assertActorHeader, idempotencyKey, queryObject, readArtifactJson } from '@/features/artifacts/server/http';
import type { IdentityActor } from '@/features/identity/server/handlers';
import { assertOrigin, IdentityError, json, limit, validate } from '@/features/identity/server/http';
import { createCalculationService } from './calculations';

export function createCalculationHandlers(options: { pool: Pool; origin: string; getActor(headers: Headers): Promise<IdentityActor> }) {
  const service = createCalculationService(options.pool);
  return async (request: Request, action: 'prepare' | 'apply'): Promise<Response> => {
    try {
      if (request.method !== 'POST') throw new IdentityError('NOT_FOUND', 'sheets.errors.notFound');
      assertOrigin(request, options.origin); queryObject(new URL(request.url), []);
      const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
      await limit(options.pool, `sheet-calculation:${actor.user.id}:${action}`, action === 'apply' ? 60 : 120, 60);
      const principal = { kind: 'session' as const, userId: actor.user.id, sessionId: actor.session.id };
      const input = await readArtifactJson(request);
      if (action === 'prepare') return json(await service.prepare(principal, validate(PrepareCalculationRequestSchema, input)));
      return json(await service.apply(principal, idempotencyKey(request), validate(ApplyPreparedCalculationRequestSchema, input)));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('sheets.errors.')) return artifactErrorResponse(new IdentityError('VALIDATION_FAILED', error.message));
      if (error instanceof z.ZodError) return artifactErrorResponse(error);
      return artifactErrorResponse(error);
    }
  };
}
