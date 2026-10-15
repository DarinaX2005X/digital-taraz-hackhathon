/** Confirmed logout removes this account's first-work input and pending run context. */
export function clearPrivateTabDrafts(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>, ownerId: string) {
  const prefixes = [`tirlik.entry-draft.v1:${ownerId}:`, `tirlik.task-request.v1:${ownerId}:`];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key));
  for (const key of keys) if (prefixes.some((prefix) => key.startsWith(prefix))) storage.removeItem(key);
  storage.removeItem('tirlik.public-goal.v1');
}
