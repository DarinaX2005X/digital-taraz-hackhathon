import { z } from 'zod';

export const TOUR_VERSION = 2;
export const TourStepSchema = z.enum(['start', 'task', 'materials', 'edit', 'history', 'export']);
export type TourStep = z.infer<typeof TourStepSchema>;
export const TOUR_STEPS = TourStepSchema.options;
export const TourStateSchema = z.enum(['available', 'active', 'skipped', 'completed']);
export type TourState = z.infer<typeof TourStateSchema>;

const CompletedStepsSchema = z.array(TourStepSchema).max(TOUR_STEPS.length).superRefine((value, context) => {
  if (new Set(value).size !== value.length) {
    context.addIssue({ code: 'custom', message: 'Tour steps cannot be completed twice.' });
  }
  if (value.some((step, index) => step !== TOUR_STEPS[index])) {
    context.addIssue({ code: 'custom', message: 'Tour steps must be completed in order.' });
  }
});

export const TourProgressSchema = z.strictObject({
  version: z.literal(TOUR_VERSION), revision: z.number().int().nonnegative(),
  state: TourStateSchema,
  completedSteps: CompletedStepsSchema,
}).refine((value) => value.state !== 'completed' || value.completedSteps.length === TOUR_STEPS.length, {
  message: 'Every tour step is required before completion.', path: ['completedSteps'],
});
export type TourProgress = z.infer<typeof TourProgressSchema>;
export const UpdateTourSchema = z.strictObject({
  version: z.literal(TOUR_VERSION), expectedRevision: z.number().int().nonnegative(),
  state: TourStateSchema.exclude(['available']), completedSteps: CompletedStepsSchema,
}).refine((value) => value.state !== 'completed' || value.completedSteps.length === TOUR_STEPS.length, {
  message: 'Every tour step is required before completion.', path: ['completedSteps'],
});
export type UpdateTour = z.infer<typeof UpdateTourSchema>;
export const emptyTour = (): TourProgress => ({ version: TOUR_VERSION, revision: 0, state: 'available', completedSteps: [] });
