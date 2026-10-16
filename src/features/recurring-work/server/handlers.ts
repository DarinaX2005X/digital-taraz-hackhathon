import type { Pool } from 'pg';
import { z } from 'zod';
import { StartWorkOccurrenceInputSchema } from '../../../contracts/business-work';
import { IdSchema } from '../../../contracts/primitives';
import { artifactErrorResponse, assertActorHeader, idempotencyKey, queryObject, readArtifactJson } from '../../artifacts/server/http';
import type { IdentityActor } from '../../identity/server/handlers';
import { assertOrigin, IdentityError, json, limit, validate } from '../../identity/server/http';
import { CreateOutcomeObservationSchema, CreateWorkRuleSchema, ListOutcomesSchema, ListWorkOccurrencesSchema, ListWorkRulesSchema, OccurrenceMutationSchema, RestartOccurrenceSchema, SetWorkRuleStateSchema, UpdateWorkRuleSchema } from '../contracts';
import { createOutcomeService } from './outcomes';
import { createRecurringWorkService } from './rules';
import type { RecurringRunBridge } from './runtime-bridge';

const positive = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive());
export function createRecurringWorkHandlers(options: { pool: Pool; origin: string; getActor(headers: Headers): Promise<IdentityActor>; getBridge?: () => RecurringRunBridge | undefined }) {
  const rules = createRecurringWorkService(options.pool, options.getBridge), outcomes = createOutcomeService(options.pool);
  return async function handle(request: Request, root: 'work-rules' | 'outcomes'): Promise<Response> {
    try {
      const writing = request.method === 'POST'; if (writing) assertOrigin(request, options.origin);
      const actor = await options.getActor(request.headers); assertActorHeader(request, actor.user.id);
      await limit(options.pool, `recurring-work:${actor.user.id}:${writing ? 'write' : 'read'}`, writing ? 180 : 900, 60);
      const principal = { kind: 'session' as const, userId: actor.user.id, sessionId: actor.session.id };
      const url = new URL(request.url), parts = url.pathname.slice(`/api/${root}`.length).split('/').filter(Boolean);
      if (root === 'outcomes') {
        if (request.method === 'GET' && !parts.length) {
          const query = queryObject(url, ['workspaceId', 'projectId', 'limit']);
          return json(await outcomes.list(principal, validate(ListOutcomesSchema, { ...query, ...(query.limit ? { limit: validate(positive, query.limit) } : {}) })));
        }
        if (writing && !parts.length) { queryObject(url, []); return json(await outcomes.create(principal, idempotencyKey(request), validate(CreateOutcomeObservationSchema, await readArtifactJson(request))), 201); }
      }
      if (root === 'work-rules') {
        if (request.method === 'GET') {
          const query = queryObject(url, parts.length === 2 && parts[1] === 'occurrences' ? ['workspaceId', 'limit'] : parts.length ? ['workspaceId', 'version'] : ['workspaceId', 'projectId', 'state', 'limit']);
          if (!parts.length) return json(await rules.list(principal, validate(ListWorkRulesSchema, { ...query, ...(query.limit ? { limit: validate(positive, query.limit) } : {}) })));
          if (parts.length === 1) return json(await rules.read(principal, validate(IdSchema, query.workspaceId), validate(IdSchema, parts[0]), query.version ? validate(positive, query.version) : undefined));
          if (parts.length === 2 && parts[1] === 'occurrences') return json(await rules.occurrences(principal, validate(ListWorkOccurrencesSchema, { workspaceId: query.workspaceId, ruleId: parts[0], ...(query.limit ? { limit: validate(positive, query.limit) } : {}) })));
        }
        if (writing) {
          queryObject(url, []); const body = await readArtifactJson(request), key = idempotencyKey(request);
          if (!parts.length) return json(await rules.create(principal, key, validate(CreateWorkRuleSchema, body)), 201);
          if (parts.length === 2 && parts[1] === 'update') return json(await rules.update(principal, key, validate(IdSchema, parts[0]), validate(UpdateWorkRuleSchema, body)));
          if (parts.length === 2 && parts[1] === 'state') return json(await rules.setState(principal, key, validate(IdSchema, parts[0]), validate(SetWorkRuleStateSchema, body)));
          if (parts.length === 2 && parts[1] === 'occurrences') {
            const occurrence = StartWorkOccurrenceInputSchema.parse(body); if (occurrence.ruleId !== validate(IdSchema, parts[0])) throw new IdentityError('VALIDATION_FAILED', 'identity.errors.validationFailed');
            return json(await rules.start(principal, occurrence), 201);
          }
          if (parts.length === 3 && parts[0] === 'occurrences' && parts[2] === 'cancel') return json(await rules.cancel(principal, key, validate(IdSchema, parts[1]), validate(OccurrenceMutationSchema, body)));
          if (parts.length === 3 && parts[0] === 'occurrences' && parts[2] === 'restart') {
            const mutation = validate(OccurrenceMutationSchema, body);
            return json(await rules.restart(principal, validate(RestartOccurrenceSchema, { ...mutation, occurrenceId: parts[1] })), 201);
          }
        }
      }
      throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
    } catch (error) { return artifactErrorResponse(error); }
  };
}
