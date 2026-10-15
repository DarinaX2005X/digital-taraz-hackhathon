import type { ArtifactOperationResult } from './execute-operation';
import type { ArtifactOperation } from './operations';

export const artifactHistoryHref = (projectId: string, artifactId: string) => `/app/projects/${projectId}/artifacts/${artifactId}/history`;

/** An uncertain request cannot change location; a validated receipt can, including replay. */
export function confirmedHistoryMove(operation: ArtifactOperation | undefined, result: ArtifactOperationResult | undefined) {
  if (operation?.kind !== 'move' || !result || !('artifact' in result)) return null;
  if (result.artifact.id !== operation.artifactId || result.artifact.projectId !== operation.body.projectId) return null;
  return { projectId: result.artifact.projectId, href: artifactHistoryHref(result.artifact.projectId, result.artifact.id), revision: result.artifact.currentRevision };
}
