export interface ProjectSessionDraft { title: string; goal: string; baseRevision: number }

export function projectSessionDraftKey(ownerId: string, projectId: string) {
  return `tirlik.project-session.v1:${ownerId}:${projectId}`;
}

export function readProjectSessionDraft(value: string | null): ProjectSessionDraft | undefined {
  if (!value) return;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return;
    const draft = parsed as Record<string, unknown>;
    if (typeof draft.title !== 'string' || !draft.title.trim() || draft.title.length > 240) return;
    if (typeof draft.goal !== 'string' || draft.goal.length > 12000) return;
    if (!Number.isInteger(draft.baseRevision) || Number(draft.baseRevision) < 1) return;
    return { title: draft.title, goal: draft.goal, baseRevision: Number(draft.baseRevision) };
  } catch { return; }
}
