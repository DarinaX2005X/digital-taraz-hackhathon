import type { ProjectListResult } from '../contracts';

export type ProjectListState = { context: string; request: number; page?: ProjectListResult; loading: boolean; error?: unknown };
export type ProjectListAction =
  | { type: 'begin'; context: string; request: number }
  | { type: 'resolved'; context: string; request: number; page: ProjectListResult; append: boolean }
  | { type: 'failed'; context: string; request: number; error: unknown }
  | { type: 'invalidate' };
export const initialProjectListState: ProjectListState = { context: '', request: 0, loading: false };

export function projectListReducer(state: ProjectListState, action: ProjectListAction): ProjectListState {
  if (action.type === 'invalidate') return { ...state, page: undefined, loading: false, error: undefined, request: state.request + 1 };
  if (action.type === 'begin') return { context: action.context, request: action.request, loading: true, page: state.context === action.context ? state.page : undefined };
  if (state.context !== action.context || state.request !== action.request) return state;
  if (action.type === 'failed') {
    const status = action.error && typeof action.error === 'object' && 'status' in action.error ? action.error.status : undefined;
    return { ...state, loading: false, error: action.error, page: status === 403 || status === 404 ? undefined : state.page };
  }
  const projects = action.append && state.page
    ? [...state.page.projects, ...action.page.projects.filter((item) => !state.page!.projects.some((existing) => existing.id === item.id))]
    : action.page.projects;
  return { ...state, page: { ...action.page, projects }, loading: false, error: undefined };
}
