import { ProjectPackageListResultSchema, ProjectPackageSchema, CreateProjectPackageSchema, type CreateProjectPackage } from './contracts';
import type { ArtifactViewer } from '../artifacts/contracts';

export class ProjectPackageRequestError extends Error { constructor(readonly status: number, readonly uncertain: boolean) { super('project-package-request-failed'); } }
async function json(response: Response, uncertain: boolean) {
  const maximum = 24 * 1024 * 1024;
  if (Number(response.headers.get('Content-Length')) > maximum) throw new ProjectPackageRequestError(response.status, uncertain);
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximum) throw new ProjectPackageRequestError(response.status, uncertain);
  try { return JSON.parse(text) as unknown; } catch { throw new ProjectPackageRequestError(response.status, uncertain); }
}
export function createProjectPackageClient(viewer: ArtifactViewer, projectId: string, fetcher: typeof fetch = fetch) {
  const headers = (body = false, key?: string) => ({ Accept: 'application/json', 'X-Tirlik-User-Id': viewer.userId, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) });
  async function request(path: string, init: RequestInit, uncertain: boolean) {
    let response: Response;
    try { response = await fetcher(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', ...init }); }
    catch { throw new ProjectPackageRequestError(0, uncertain); }
    const body = await json(response, uncertain);
    if (!response.ok) throw new ProjectPackageRequestError(response.status, uncertain && response.status >= 500);
    return body;
  }
  return {
    list: async (signal?: AbortSignal) => {
      const query = new URLSearchParams({ workspaceId: viewer.workspaceId, projectId });
      const result = ProjectPackageListResultSchema.parse(await request(`/api/packages?${query}`, { headers: headers(), signal }, false));
      if (result.authzVersion < viewer.authzVersion || result.packages.some((item) => item.workspaceId !== viewer.workspaceId || item.release.projectId !== projectId)) throw new ProjectPackageRequestError(0, false);
      return result;
    },
    create: async (input: CreateProjectPackage, operationId: string, signal?: AbortSignal) => {
      const body = CreateProjectPackageSchema.parse(input);
      if (body.workspaceId !== viewer.workspaceId || body.release.projectId !== projectId || body.expectedAuthzVersion < viewer.authzVersion) throw new ProjectPackageRequestError(409, false);
      return ProjectPackageSchema.parse(await request('/api/packages', { method: 'POST', headers: headers(true, operationId), body: JSON.stringify(body), signal }, true));
    },
    render: async (id: string, expectedAuthzVersion: number, signal?: AbortSignal) => ProjectPackageSchema.parse(await request(`/api/exports/${id}/render`, { method: 'POST', headers: headers(true), body: JSON.stringify({ workspaceId: viewer.workspaceId, expectedAuthzVersion }), signal }, true)),
    download: async (id: string, signal?: AbortSignal) => {
      let response: Response;
      try { response = await fetcher(`/api/exports/${id}/bundle?workspaceId=${viewer.workspaceId}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer', headers: headers(), signal }); }
      catch { throw new ProjectPackageRequestError(0, false); }
      if (!response.ok) throw new ProjectPackageRequestError(response.status, false);
      return { blob: await response.blob(), fileName: response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/)?.[1] ? decodeURIComponent(response.headers.get('content-disposition')!.match(/filename\*=UTF-8''([^;]+)/)![1]!) : 'Tirlik.zip' };
    },
  };
}
