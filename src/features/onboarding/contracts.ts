import { z } from 'zod';

export const TOUR_VERSION = 1;
export const TourStepSchema = z.enum(['start', 'task', 'materials', 'edit', 'history', 'export']);
export type TourStep = z.infer<typeof TourStepSchema>;
export const TourProgressSchema = z.strictObject({
  version: z.literal(TOUR_VERSION), revision: z.number().int().nonnegative(),
  state: z.enum(['available', 'active', 'skipped', 'completed']),
  completedSteps: z.array(TourStepSchema).max(6).refine((value) => new Set(value).size === value.length),
});
export type TourProgress = z.infer<typeof TourProgressSchema>;
export const UpdateTourSchema = z.strictObject({
  version: z.literal(TOUR_VERSION), expectedRevision: z.number().int().nonnegative(),
  state: z.enum(['active', 'skipped', 'completed']), completedSteps: z.array(TourStepSchema).max(6).refine((value) => new Set(value).size === value.length),
}).refine((value) => value.state !== 'completed' || value.completedSteps.length === 6);
export type UpdateTour = z.infer<typeof UpdateTourSchema>;
export const emptyTour = (): TourProgress => ({ version: TOUR_VERSION, revision: 0, state: 'available', completedSteps: [] });
