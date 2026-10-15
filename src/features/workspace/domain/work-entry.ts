/** Navigation state contains identifiers only; entered text never belongs in a URL. */
export function workEntryHref(workspaceId?: string, intentToken?: string) {
  const query = new URLSearchParams();
  if (workspaceId) query.set('workspace', workspaceId);
  if (intentToken) query.set('intent', intentToken);
  return `/app/work${query.size ? `?${query}` : ''}`;
}

export function restoreEntryGoal(current: string, restored: string) {
  // A delayed restore may not replace a goal the person has already begun editing.
  return current || restored;
}

export function initialWorkspaceSelection(ids: readonly string[], requested?: string) {
  if (requested) return requested;
  return ids.length === 1 ? ids[0]! : '';
}
