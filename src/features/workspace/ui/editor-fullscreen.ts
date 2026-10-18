type ClosestTarget = { closest: (selector: string) => unknown };

/** Escape belongs to an overlay only when that overlay is nested inside the expanded editor. */
export function escapeBelongsToNestedDialog(target: unknown, editorRoot: unknown): boolean {
  if (!target || typeof target !== 'object' || typeof (target as Partial<ClosestTarget>).closest !== 'function') return false;
  const dialog = (target as ClosestTarget).closest('[role="dialog"]');
  return dialog !== null && dialog !== undefined && dialog !== editorRoot;
}

export function fullscreenTabDestination<T>(
  active: T | null,
  editorRoot: T | null,
  first: T | undefined,
  last: T | undefined,
  reverse: boolean,
  isInside: (candidate: T) => boolean,
): T | undefined {
  if (!first || !last) return editorRoot ?? undefined;
  if (active === null || active === editorRoot || !isInside(active)) return reverse ? last : first;
  if (reverse && active === first) return last;
  if (!reverse && active === last) return first;
  return undefined;
}
