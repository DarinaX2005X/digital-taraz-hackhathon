import { IdSchema } from '@/contracts/primitives';
import { RunsPage } from '@/features/runs/ui/runs-page';
import { readWorkspaceSelection, type IdentitySearchParams } from '@/server/identity-navigation';
import { RouteState } from '@/ui/route-state';

export default async function Page({ searchParams }: { searchParams: Promise<IdentitySearchParams> }) {
  const query = await searchParams;
  const selection = readWorkspaceSelection(query);
  const project = query.project === undefined ? undefined : IdSchema.safeParse(query.project);
  if (!selection.valid || (project && !project.success)) return <RouteState kind="invalid-workspace" />;
  return <RunsPage initialWorkspaceId={selection.workspaceId} projectId={project?.success ? project.data : undefined} />;
}
