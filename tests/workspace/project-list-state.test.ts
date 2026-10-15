import { describe, expect, it } from 'vitest';
import type { ProjectListResult } from '../../src/features/workspace/contracts';
import { initialProjectListState, projectListReducer } from '../../src/features/workspace/domain/project-list-state';

const page = (ids: string[], cursor = '7', nextAfter: string | null = null): ProjectListResult => ({
  projects: ids.map((id) => ({ id, workspaceId: 'workspace', title: id, goal: null, status: 'active', revision: 1, createdBy: 'actor', createdAt: '2026-10-14T12:00:00Z', updatedAt: '2026-10-14T12:00:00Z' })), authzVersion: 1, cursor, nextAfter,
});
const loaded = () => projectListReducer(projectListReducer(initialProjectListState, { type: 'begin', context: 'actor:workspace:active:', request: 1 }), { type: 'resolved', context: 'actor:workspace:active:', request: 1, page: page(['a', 'b'], '7', 'next'), append: false });

describe('project list asynchronous state', () => {
  it('ignores late results from an old search, including an old load-more request', () => {
    const state = projectListReducer(loaded(), { type: 'begin', context: 'actor:workspace:active:invoice', request: 3 });
    expect(state.page).toBeUndefined();
    expect(projectListReducer(state, { type: 'resolved', context: 'actor:workspace:active:', request: 2, page: page(['c']), append: true })).toBe(state);
    expect(projectListReducer(state, { type: 'failed', context: 'actor:workspace:active:', request: 2, error: new Error('late') })).toBe(state);
  });
  it('keeps existing rows on connection failure and uses the returned continuation and event cursor', () => {
    const pending = projectListReducer(loaded(), { type: 'begin', context: 'actor:workspace:active:', request: 2 });
    const failed = projectListReducer(pending, { type: 'failed', context: pending.context, request: 2, error: { status: 0 } });
    expect(failed.page?.projects.map((item) => item.id)).toEqual(['a', 'b']);
    const retry = projectListReducer(failed, { type: 'begin', context: pending.context, request: 3 });
    const resolved = projectListReducer(retry, { type: 'resolved', context: retry.context, request: 3, page: page(['b', 'c'], '12', null), append: true });
    expect(resolved.page?.projects.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(resolved.page?.cursor).toBe('12');
    expect(resolved.page?.nextAfter).toBeNull();
    expect(resolved.error).toBeUndefined();
  });
  it('clears revoked or cursor-reset rows before fresh authorization and rejects an in-flight response', () => {
    const state = loaded();
    const invalidated = projectListReducer(state, { type: 'invalidate' });
    expect(invalidated.page).toBeUndefined();
    expect(projectListReducer(invalidated, { type: 'resolved', context: state.context, request: 1, page: page(['old-private']), append: false })).toBe(invalidated);
    const pending = projectListReducer(state, { type: 'begin', context: state.context, request: 2 });
    expect(projectListReducer(pending, { type: 'failed', context: state.context, request: 2, error: { status: 403 } }).page).toBeUndefined();
  });
  it('replaces pagination on a fresh event snapshot instead of retaining stale second-page rows', () => {
    const state = loaded();
    const pending = projectListReducer(state, { type: 'begin', context: state.context, request: 2 });
    const next = projectListReducer(pending, { type: 'resolved', context: state.context, request: 2, page: page(['new'], '19', 'new-next'), append: false });
    expect(next.page?.projects.map((item) => item.id)).toEqual(['new']);
    expect(next.page?.cursor).toBe('19');
  });
});
