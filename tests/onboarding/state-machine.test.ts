import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { emptyTour, type TourProgress } from '@/features/onboarding/contracts';
import {
  completeTourStep,
  createTourTransition,
  firstAvailableTourStep,
  focusableTourAnchor,
  markTourTransitionReturning,
  nextTourStep,
  parseTourTransitionAt,
  previousCompletedSteps,
  resolveTourView,
  shouldClearTourTransition,
  toInternalTourPath,
  tourDismissedKey,
  tourTransitionKey,
} from '@/features/onboarding/state-machine';

const active = (completedSteps: TourProgress['completedSteps'] = []): TourProgress => ({
  ...emptyTour(),
  revision: 4,
  state: 'active',
  completedSteps,
});

describe('onboarding route and step state machine', () => {
  it('keeps the visible tour on the current route without navigation controls', () => {
    const source = readFileSync(new URL('../../src/features/onboarding/tour.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain("from 'next/link'");
    expect(source).not.toContain('router.push(destination)');
    expect(source).not.toContain('createTourTransition');
    expect(source).not.toContain('routeAction');
    expect(source).toContain("router.push('/app/work')"); // settings action only
  });

  it('uses the next applicable target on the current route without completing unseen steps', () => {
    const progress = active(['start']);
    expect(nextTourStep(progress)).toBe('task');
    expect(resolveTourView(progress, { materials: 'project-materials' }, '/app/projects/p1')).toEqual({
      kind: 'step',
      step: 'materials',
      anchorId: 'project-materials',
    });
    expect(progress.completedSteps).toEqual(['start']);
  });

  it('requires an explicit Materials action and preserves its exact destination and return path', () => {
    const progress = active(['start', 'task']);
    expect(resolveTourView(progress, { materials: 'project-materials' }, '/app/projects/p1')).toEqual({
      kind: 'step',
      step: 'materials',
      anchorId: 'project-materials',
    });
    const transition = createTourTransition({
      ownerId: 'user-1',
      id: 'transition-1',
      step: 'materials',
      destination: '/app/materials/add?workspaceId=w1&projectId=p1',
      returnTo: '/app/projects/p1?run=r1',
      createdAt: 100,
    });
    expect(transition).toMatchObject({
      step: 'materials',
      nextStep: 'edit',
      destination: '/app/materials/add?workspaceId=w1&projectId=p1',
      returnTo: '/app/projects/p1?run=r1',
    });
    expect(completeTourStep(progress, 'materials')).toEqual(['start', 'task', 'materials']);
  });

  it('returns from Materials to one explicit continuation instead of replaying a stale anchor', () => {
    const progress = active(['start', 'task', 'materials']);
    const transition = createTourTransition({
      ownerId: 'user-1',
      id: 'transition-1',
      step: 'materials',
      destination: '/app/materials/add?workspaceId=w1&projectId=p1',
      returnTo: '/app/projects/p1?run=r1',
      createdAt: 100,
    });
    expect(resolveTourView(progress, { start: 'work-start' }, '/app/work', transition)).toEqual({ kind: 'waiting', step: 'edit' });
    expect(resolveTourView(progress, { start: 'work-start' }, '/app/materials/add?workspaceId=w1&projectId=p1', transition)).toEqual({
      kind: 'resume',
      step: 'edit',
      href: '/app/projects/p1?run=r1',
      transition,
    });
    const returning = markTourTransitionReturning(transition);
    expect(resolveTourView(progress, { start: 'work-start' }, '/app/work', returning)).toEqual({
      kind: 'waiting',
      step: 'edit',
    });
    expect(shouldClearTourTransition(progress, '/app/work', returning)).toBe(true);
    expect(shouldClearTourTransition(progress, '/app/projects/p1?run=r1', transition)).toBe(true);
    expect(resolveTourView(progress, { start: 'work-start' }, '/app/projects/p1?run=r1', transition)).toEqual({ kind: 'waiting', step: 'edit' });
    expect(resolveTourView(progress, { start: 'work-start' }, '/app/work')).toEqual({
      kind: 'waiting',
      step: 'edit',
    });
  });

  it('keeps transition context across refresh but rejects another user or tour version', () => {
    const transition = createTourTransition({
      ownerId: 'user-1',
      id: 'transition-1',
      step: 'materials',
      destination: '/app/materials/add?workspaceId=w1&projectId=p1',
      returnTo: '/app/projects/p1',
      createdAt: 100,
    });
    const stored = JSON.stringify(transition);
    expect(parseTourTransitionAt(stored, 'user-1', 200)).toEqual(transition);
    expect(parseTourTransitionAt(stored, 'user-2', 200)).toBeUndefined();
    expect(parseTourTransitionAt(stored.replace('"version":2', '"version":99'), 'user-1', 200)).toBeUndefined();
    expect(parseTourTransitionAt('{broken', 'user-1', 200)).toBeUndefined();
    expect(parseTourTransitionAt(stored, 'user-1', 100 + 24 * 60 * 60 * 1000 + 1)).toBeUndefined();
    expect(tourTransitionKey('user/1')).toContain('user%2F1');
    expect(tourDismissedKey('user/1')).toContain('user%2F1');
  });

  it('keeps internal route context unchanged and refuses an external destination', () => {
    const base = 'http://tirlik.local/app/projects/p1?run=r1';
    expect(toInternalTourPath('/app/materials/add?projectId=p1#upload', base)).toBe('/app/materials/add?projectId=p1#upload');
    expect(toInternalTourPath('https://other.invalid/app/materials', base)).toBeUndefined();
    expect(toInternalTourPath('//other.invalid/app/materials', base)).toBeUndefined();
  });

  it('moves back deterministically without resetting the tour or the account revision', () => {
    const progress = active(['start', 'task', 'materials']);
    expect(previousCompletedSteps(progress)).toEqual(['start', 'task']);
    expect(progress).toMatchObject({ revision: 4, state: 'active' });
  });

  it('waits when no target exists and records only the contextual step the user actually visits', () => {
    const progress = active(['start']);
    expect(resolveTourView(progress, {}, '/app/work')).toEqual({ kind: 'waiting', step: 'task' });
    expect(firstAvailableTourStep(progress, {})).toBeUndefined();
    expect(firstAvailableTourStep(active(), { edit: 'artifact-editor', history: 'artifact-history' })).toBe('edit');
    expect(resolveTourView(active(), { edit: 'artifact-editor' }, '/app/artifacts/a1')).toEqual({ kind: 'step', step: 'edit', anchorId: 'artifact-editor' });
    expect(completeTourStep(active(), 'edit')).toEqual(['edit']);
    expect(completeTourStep(progress, 'materials')).toEqual(['start', 'materials']);
    expect(completeTourStep(progress, 'task')).toEqual(['start', 'task']);
  });

  it('waits for a real project result before exposing the edit step', () => {
    const progress = active(['start', 'task', 'materials']);
    const emptyProjectAnchors = { task: 'project-session', materials: 'project-sources' } as const;

    expect(resolveTourView(progress, emptyProjectAnchors, '/app/projects/p1')).toEqual({ kind: 'waiting', step: 'edit' });
    expect(resolveTourView(progress, { ...emptyProjectAnchors, edit: 'project-results' }, '/app/projects/p1')).toEqual({
      kind: 'step',
      step: 'edit',
      anchorId: 'project-results',
    });
  });

  it('moves Back through visited contextual steps instead of aligning forward again', () => {
    const progress = active(['task', 'materials']);
    const anchors = { task: 'project-session', materials: 'project-materials', edit: 'project-results' } as const;
    expect(resolveTourView(progress, anchors, '/app/projects/p1')).toMatchObject({ kind: 'step', step: 'edit' });
    const once = active(previousCompletedSteps(progress, 'edit', anchors));
    expect(once.completedSteps).toEqual(['task']);
    expect(resolveTourView(once, anchors, '/app/projects/p1')).toMatchObject({ kind: 'step', step: 'materials' });
    const twice = active(previousCompletedSteps(once, 'materials', anchors));
    expect(twice.completedSteps).toEqual([]);
    expect(resolveTourView(twice, anchors, '/app/projects/p1')).toMatchObject({ kind: 'step', step: 'task' });
    expect(previousCompletedSteps(active(['edit']), 'task', anchors)).toBeUndefined();
  });

  it('never exposes a focus target while the guide is hidden, unready, or dismissed', () => {
    const view = { kind: 'step' as const, step: 'edit' as const, anchorId: 'artifact-editor' };
    expect(focusableTourAnchor(view, true, true, false)).toBe('artifact-editor');
    expect(focusableTourAnchor(view, false, true, false)).toBeUndefined();
    expect(focusableTourAnchor(view, true, false, false)).toBeUndefined();
    expect(focusableTourAnchor(view, true, true, true)).toBeUndefined();
  });

  it('automatically reveals the active target and exposes no missing-step or show button', () => {
    const source = readFileSync(new URL('../../src/features/onboarding/tour.tsx', import.meta.url), 'utf8');
    const copy = readFileSync(new URL('../../src/features/onboarding/copy.ts', import.meta.url), 'utf8');
    expect(source).toContain('if (!focusAnchorId) return');
    expect(source).toContain('scrollIntoView');
    expect(source).toContain('focusableTourAnchor');
    expect(source).not.toContain('LocateFixed');
    expect(source).not.toContain('t.show');
    expect(source).not.toContain('t.skipStep');
    expect(copy).not.toMatch(/Пропустить отсутствующий шаг|Skip unavailable step|Жоқ қадамды өткізіп жіберу/);
  });
});
