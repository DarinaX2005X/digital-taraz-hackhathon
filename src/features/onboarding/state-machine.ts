import { z } from 'zod';
import {
  TOUR_STEPS,
  TOUR_VERSION,
  TourStepSchema,
  type TourProgress,
  type TourStep,
} from './contracts';

export const TOUR_TRANSITION_TTL_MS = 24 * 60 * 60 * 1000;

const InternalPathSchema = z.string().min(1).refine(
  (value) => value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'),
  'Tour routes must stay inside Tirlik.',
);

export const TourTransitionSchema = z.strictObject({
  version: z.literal(TOUR_VERSION),
  ownerId: z.string().min(1),
  id: z.string().min(1),
  step: TourStepSchema,
  nextStep: TourStepSchema.nullable(),
  destination: InternalPathSchema,
  returnTo: InternalPathSchema,
  phase: z.enum(['departing', 'returning']),
  createdAt: z.number().int().nonnegative(),
});
export type TourTransition = z.infer<typeof TourTransitionSchema>;

export type TourView =
  | { kind: 'welcome' }
  | { kind: 'step'; step: TourStep; anchorId: string }
  | { kind: 'resume'; step: TourStep; href: string; transition: TourTransition }
  | { kind: 'unavailable'; step: TourStep }
  | { kind: 'hidden' };

export function orderedCompletedSteps(completedSteps: readonly TourStep[]) {
  const completed = new Set(completedSteps);
  return TOUR_STEPS.filter((step) => completed.has(step));
}

export function nextTourStep(progress: Pick<TourProgress, 'completedSteps'>): TourStep | undefined {
  const completed = new Set(progress.completedSteps);
  return TOUR_STEPS.find((step) => !completed.has(step));
}

export function completedThrough(progress: Pick<TourProgress, 'completedSteps'>, step: TourStep) {
  const position = TOUR_STEPS.indexOf(step);
  if (step !== nextTourStep(progress)) return orderedCompletedSteps(progress.completedSteps);
  return TOUR_STEPS.slice(0, position + 1);
}

export function previousCompletedSteps(progress: Pick<TourProgress, 'completedSteps'>) {
  const completed = orderedCompletedSteps(progress.completedSteps);
  return completed.slice(0, -1);
}

export function resolveTourView(
  progress: TourProgress,
  anchors: Partial<Record<TourStep, string>>,
  pathname: string,
  transition?: TourTransition,
): TourView {
  if (progress.state === 'available') return { kind: 'welcome' };
  if (progress.state !== 'active') return { kind: 'hidden' };
  const step = nextTourStep(progress);
  if (!step) return { kind: 'hidden' };
  const anchorId = anchors[step];
  if (anchorId) return { kind: 'step', step, anchorId };
  if (
    transitionStillRelevant(progress, transition)
    && transition.phase === 'departing'
    && sameTourPath(transition.destination, pathname)
    && !sameTourPath(transition.returnTo, pathname)
  ) {
    return { kind: 'resume', step, href: transition.returnTo, transition };
  }
  return { kind: 'unavailable', step };
}

export function transitionStillRelevant(
  progress: Pick<TourProgress, 'completedSteps'>,
  transition?: TourTransition,
): transition is TourTransition {
  return Boolean(transition && transition.nextStep === nextTourStep(progress));
}

export function shouldClearTourTransition(
  progress: Pick<TourProgress, 'completedSteps'>,
  pathname: string,
  transition?: TourTransition,
) {
  if (!transition) return false;
  if (!transitionStillRelevant(progress, transition)) return true;
  return transition.phase === 'returning' || sameTourPath(transition.returnTo, pathname);
}

export function createTourTransition(input: {
  ownerId: string;
  id: string;
  step: TourStep;
  destination: string;
  returnTo: string;
  createdAt?: number;
}): TourTransition {
  const position = TOUR_STEPS.indexOf(input.step);
  return TourTransitionSchema.parse({
    version: TOUR_VERSION,
    ownerId: input.ownerId,
    id: input.id,
    step: input.step,
    nextStep: TOUR_STEPS[position + 1] ?? null,
    destination: input.destination,
    returnTo: input.returnTo,
    phase: 'departing',
    createdAt: input.createdAt ?? Date.now(),
  });
}

export function markTourTransitionReturning(transition: TourTransition): TourTransition {
  return { ...transition, phase: 'returning' };
}

export function tourTransitionKey(ownerId: string) {
  return `tirlik.onboarding.transition.v${TOUR_VERSION}.${encodeURIComponent(ownerId)}`;
}

export function tourDismissedKey(ownerId: string) {
  return `tirlik.onboarding.dismissed.v${TOUR_VERSION}.${encodeURIComponent(ownerId)}`;
}

export function parseTourTransition(value: string | null, ownerId: string): TourTransition | undefined {
  return parseTourTransitionAt(value, ownerId, Date.now());
}

export function parseTourTransitionAt(value: string | null, ownerId: string, now: number): TourTransition | undefined {
  if (!value) return undefined;
  try {
    const parsed = TourTransitionSchema.safeParse(JSON.parse(value));
    if (!parsed.success || parsed.data.ownerId !== ownerId) return undefined;
    if (parsed.data.createdAt > now + 60_000 || now - parsed.data.createdAt > TOUR_TRANSITION_TTL_MS) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

export function toInternalTourPath(href: string, base: string) {
  try {
    const target = new URL(href, base);
    const current = new URL(base);
    if (target.origin !== current.origin) return undefined;
    const path = `${target.pathname}${target.search}${target.hash}`;
    return InternalPathSchema.safeParse(path).success ? path : undefined;
  } catch {
    return undefined;
  }
}

export function sameTourPath(left: string, right: string) {
  const normalize = (value: string) => {
    try {
      const parsed = new URL(value, 'http://tirlik.local');
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return value;
    }
  };
  return normalize(left) === normalize(right);
}
