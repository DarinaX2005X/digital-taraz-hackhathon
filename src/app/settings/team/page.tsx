import { TeamSettingsPage } from '@/features/identity/ui';
import { readWorkspaceSelection, type IdentitySearchParams } from '@/server/identity-navigation';
import { RouteState } from '@/ui/route-state';

export default async function Page({ searchParams }: { searchParams: Promise<IdentitySearchParams> }) {
  const selection = readWorkspaceSelection(await searchParams);
  // Invalid filters are a state of this existing page, not another workspace.
  if (!selection.valid) return <RouteState kind="invalid-workspace" />;
  return <TeamSettingsPage initialWorkspaceId={selection.workspaceId} />;
}
