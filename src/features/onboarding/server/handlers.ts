import type { Pool } from 'pg';
import type { IdentityActor } from '@/features/identity/server/handlers';
import { assertOrigin, errorResponse, IdentityError, json, limit, readJson, validate } from '@/features/identity/server/http';
import { assertActorHeader, queryObject } from '@/features/artifacts/server/http';
import { emptyTour, TOUR_VERSION, TourProgressSchema, UpdateTourSchema, type TourProgress } from '../contracts';

type Row = { tour_version: number; revision: number; state: string; completed_steps: string[] };
const dto = (row: Row): TourProgress => TourProgressSchema.parse({ version: row.tour_version, revision: row.revision, state: row.state, completedSteps: row.completed_steps });

export function createOnboardingHandler(options: { pool: Pool; origin: string; getActor: (headers: Headers) => Promise<IdentityActor> }) {
  return async function handle(request: Request) {
    try {
      if (request.method === 'POST') assertOrigin(request, options.origin);
      const actor = await options.getActor(request.headers);
      assertActorHeader(request, actor.user.id);
      queryObject(new URL(request.url), []);
      await limit(options.pool, `onboarding:${actor.user.id}`, 120, 60);
      const read = async () => (await options.pool.query<Row>('SELECT tour_version,revision,state,completed_steps FROM onboarding_progress WHERE user_id=$1 AND tour_version=$2', [actor.user.id, TOUR_VERSION])).rows[0];
      if (request.method === 'GET') { const current = await read(); return json(current ? dto(current) : emptyTour()); }
      if (request.method !== 'POST') throw new IdentityError('NOT_FOUND', 'identity.errors.notFound');
      const body = validate(UpdateTourSchema, await readJson(request));
      const result = await options.pool.query<Row>(`INSERT INTO onboarding_progress(user_id,tour_version,revision,state,completed_steps)
        SELECT $1,$2,1,$3,$4::text[] WHERE $5=0 OR EXISTS (SELECT 1 FROM onboarding_progress WHERE user_id=$1 AND tour_version=$2)
        ON CONFLICT(user_id,tour_version) DO UPDATE SET revision=onboarding_progress.revision+1,state=EXCLUDED.state,completed_steps=EXCLUDED.completed_steps,updated_at=now()
        WHERE onboarding_progress.revision=$5 RETURNING tour_version,revision,state,completed_steps`, [actor.user.id, TOUR_VERSION, body.state, body.completedSteps, body.expectedRevision]);
      if (result.rows[0]) return json(dto(result.rows[0]));
      const current = await read();
      // Repeating a lost response is harmless only when the desired preference is already exact.
      if (current && current.state === body.state && [...current.completed_steps].sort().join('|') === [...body.completedSteps].sort().join('|')) return json(dto(current));
      throw new IdentityError('CONFLICT', 'identity.errors.conflict');
    } catch (error) { return errorResponse(error); }
  };
}
