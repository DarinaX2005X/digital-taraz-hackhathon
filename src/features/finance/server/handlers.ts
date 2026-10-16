import type { Pool } from 'pg';

import { FinanceRecalculateRequestSchema } from '../contracts';
import { artifactErrorResponse, assertActorHeader, idempotencyKey, queryObject, readArtifactJson } from '@/features/artifacts/server/http';
import type { IdentityActor } from '@/features/identity/server/handlers';
import { assertOrigin, IdentityError, json, limit, validate } from '@/features/identity/server/http';
import type { SessionPrincipal } from '@/features/identity/server/access';
import { createFinanceRecalculationService } from './recalculation';

export function createFinanceHandlers(options: { pool: Pool; origin: string; getActor(headers: Headers): Promise<IdentityActor> }) {
  const service = createFinanceRecalculationService(options.pool);
  return async function financeHandler(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/finance/recalculate') throw new IdentityError('NOT_FOUND', 'artifacts.errors.notFound');
      assertOrigin(request, options.origin);
      queryObject(new URL(request.url), []);
      const actor = await options.getActor(request.headers);
      assertActorHeader(request, actor.user.id);
      await limit(options.pool, `finance-recalculate:${actor.user.id}`, 60, 60);
      const principal: SessionPrincipal = { kind: 'session', userId: actor.user.id, sessionId: actor.session.id };
      const input = validate(FinanceRecalculateRequestSchema, await readArtifactJson(request));
      return json(await service.recalculate(principal, idempotencyKey(request), input), 201);
    } catch (error) { return artifactErrorResponse(error); }
  };
}
