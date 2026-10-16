'use client';

import { useState } from 'react';
import type { Run, RunResultRef } from '@/contracts/runs';
import type { Locale } from '@/contracts/primitives';
import type { BusinessWorkPreview, WorkPreviewArtifactRef } from '@/contracts/work-preview';
import type { FinanceRecalculateRequest, FinanceRecalculateResult } from '@/features/finance/contracts';
import { FinanceWorkspace, type FinanceWorkspaceRecalculation } from '@/features/finance/ui/finance-workspace';
import { ForecastWorkspace } from '@/features/forecast/ui/forecast-workspace';
import { ProcurementWorkspace } from '@/features/procurement/ui/procurement-workspace';
import { sessionResultHref, type SessionResultHrefResolver } from './session-state';
import type { AssistantSessionTransportContext } from './assistant-session';

type FinanceRecalculator = (input: FinanceRecalculateRequest, idempotencyKey: string, context: AssistantSessionTransportContext) => Promise<FinanceRecalculateResult>;

function artifactHref(run: Run, ref: WorkPreviewArtifactRef, resolve?: SessionResultHrefResolver) {
  const result: RunResultRef = { kind: 'artifact', id: ref.artifactId, revision: ref.revision };
  return sessionResultHref(run, result, resolve);
}

export function WorkPreviewPanel({
  run,
  preview: initialPreview,
  locale,
  context,
  resultHref,
  onFinanceRecalculate,
}: {
  run: Run;
  preview: BusinessWorkPreview;
  locale: Locale;
  context: AssistantSessionTransportContext;
  resultHref?: SessionResultHrefResolver;
  onFinanceRecalculate?: FinanceRecalculator;
}) {
  const [preview, setPreview] = useState(initialPreview);
  const [prior, setPrior] = useState<WorkPreviewArtifactRef>();
  const editableHref = artifactHref(run, preview.editable, resultHref);
  if (!editableHref) return null;

  if (preview.kind === 'forecast') return <ForecastWorkspace preview={preview} locale={locale} editableHref={editableHref} />;
  if (preview.kind === 'procurement') return <ProcurementWorkspace preview={preview} locale={locale} editableHref={editableHref} />;

  async function recalculate(input: FinanceWorkspaceRecalculation) {
    if (!onFinanceRecalculate || preview.kind !== 'finance') return;
    const result = await onFinanceRecalculate({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      base: preview.editable,
      ...input,
    }, crypto.randomUUID(), context);
    if (result.work.workPreview?.kind !== 'finance') throw new Error('FINANCE_PREVIEW_REQUIRED');
    setPrior(result.comparison.base);
    setPreview(result.work.workPreview);
  }

  return <FinanceWorkspace
    preview={preview}
    locale={locale}
    editableHref={editableHref}
    priorHref={prior ? artifactHref(run, prior, resultHref) ?? undefined : undefined}
    onRecalculate={onFinanceRecalculate ? recalculate : undefined}
  />;
}
