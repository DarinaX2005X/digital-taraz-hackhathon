import { TourProgressSchema, UpdateTourSchema, type UpdateTour } from './contracts';

export class TourRequestError extends Error { constructor(readonly status: number) { super('tour-request-failed'); } }
export async function requestTour(ownerId: string, input?: UpdateTour, signal?: AbortSignal) {
  const response = await fetch('/api/onboarding', { method: input ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers: { 'X-Tirlik-User-Id': ownerId, ...(input ? { 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(UpdateTourSchema.parse(input)) } : {}) });
  if (!response.ok) throw new TourRequestError(response.status);
  return TourProgressSchema.parse(await response.json());
}
