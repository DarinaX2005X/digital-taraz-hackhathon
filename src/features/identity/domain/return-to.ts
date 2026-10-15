import { z } from 'zod';

const allowedRoots = ['/app', '/settings', '/demo'];

export function safeReturnTo(input: unknown): string {
  if (typeof input !== 'string' || input.length > 1024 || /[\\\u0000-\u0020\u007f]/.test(input) || !input.startsWith('/') || input.startsWith('//')) return '/app';
  try {
    const url = new URL(input, 'https://tirlik.invalid');
    if (url.origin !== 'https://tirlik.invalid' || !allowedRoots.some((root) => url.pathname === root || url.pathname.startsWith(`${root}/`))) return '/app';
    // Only explicitly supported opaque navigation state survives authentication.
    const result = new URLSearchParams();
    const intents = url.searchParams.getAll('intent');
    if (intents.length === 1 && /^[a-f0-9]{64}$/.test(intents[0]!)) result.set('intent', intents[0]!);
    if (['/settings/team', '/app', '/app/work', '/app/runs'].includes(url.pathname) && url.searchParams.has('workspace')) {
      const workspaces = url.searchParams.getAll('workspace');
      if (workspaces.length !== 1 || !z.uuid().safeParse(workspaces[0]).success) return '/app';
      result.set('workspace', workspaces[0]!);
    }
    const projectPathId = /^\/app\/projects\/([^/]+)$/.exec(url.pathname)?.[1];
    if (projectPathId && z.uuid().safeParse(projectPathId).success && (url.searchParams.has('sourceId') || url.searchParams.has('sourceVersionId'))) {
      for (const key of ['sourceId', 'sourceVersionId']) {
        const values = url.searchParams.getAll(key);
        if (values.length !== 1 || !z.uuid().safeParse(values[0]).success) return '/app';
        result.set(key, values[0]!);
      }
    }
    if (projectPathId && z.uuid().safeParse(projectPathId).success && url.searchParams.has('resume')) {
      const resume = url.searchParams.getAll('resume');
      if (resume.length !== 1 || resume[0] !== '1') return '/app';
      result.set('resume', '1');
    }
    const sourcePathId = /^\/app\/materials\/sources\/([^/]+)$/.exec(url.pathname)?.[1];
    const collectionPathId = /^\/app\/materials\/collections\/([^/]+)$/.exec(url.pathname)?.[1];
    const sourceKeys = url.pathname === '/app/materials'
      ? ['workspaceId', 'projectId', 'sourceId', 'sourceVersionId']
      : url.pathname === '/app/materials/add' ? ['workspaceId', 'projectId', 'sourceId']
        : sourcePathId && z.uuid().safeParse(sourcePathId).success ? ['workspaceId', 'uploadId', 'sourceVersionId']
          : collectionPathId && z.uuid().safeParse(collectionPathId).success ? ['workspaceId', 'importId'] : [];
    for (const key of sourceKeys) {
      const values = url.searchParams.getAll(key);
      if (!values.length) continue;
      if (values.length !== 1 || !z.uuid().safeParse(values[0]).success) return '/app';
      result.set(key, values[0]!);
    }
    return `${url.pathname}${result.size ? `?${result}` : ''}`;
  } catch { return '/app'; }
}

export function authReturnTo(input: unknown, intentToken?: string): string {
  const target = new URL(safeReturnTo(input), 'https://tirlik.invalid');
  if (intentToken && /^[a-f0-9]{64}$/.test(intentToken)) target.searchParams.set('intent', intentToken);
  return `${target.pathname}${target.search}`;
}
