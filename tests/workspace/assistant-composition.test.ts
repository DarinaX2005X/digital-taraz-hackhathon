import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('assistant-first workspace composition', () => {
  it('mounts every available real editor and never substitutes the content preview for a plan editor', () => {
    const source = read('src/features/workspace/ui/artifact-page.tsx');
    for (const editor of ['DocumentEditor', 'SheetEditor', 'DesignEditor', 'PlanEditor']) expect(source).toContain(editor);
    expect(source).not.toContain('ArtifactContentPreview');
    expect(source).toContain('AssistantSession');
  });

  it('shows the validated decision projection and sends only the selected option id', () => {
    const session = read('src/features/runs/ui/assistant-session.tsx');
    const decision = read('src/features/runs/ui/decision-panel.tsx');
    expect(session).toContain('data.progress.decision && <DecisionPanel');
    expect(session).toContain("mutate('resume', { selectedOptionId })");
    expect(decision).toContain('decision.options.map');
    expect(decision).toContain('businessDecisionCopy');
    expect(decision).toContain("evidence.origin === 'source'");
    expect(decision).toContain("evidence.origin === 'manual'");
    expect(decision).not.toContain('item.sourceRefs');
    expect(decision).not.toContain('toolName');
    expect(decision).not.toContain('reason.message');
  });

  it('streams only committed run events and announces bounded progress without exposing model messages', () => {
    const session = read('src/features/runs/ui/assistant-session.tsx');
    expect(session).toContain('openRunEvents');
    expect(session).toContain('aria-live="polite"');
    expect(session).toContain('setReload((value) => value + 1)');
    expect(session).toContain('data.progress.branches?.length');
    expect(session).not.toMatch(/chain.of.thought|modelMessages|tool arguments/i);
  });

  it('keeps Assistant and Result mounted behind an explicit narrow-layout switch', () => {
    const project = read('src/features/workspace/ui/project-page.tsx');
    const artifact = read('src/features/workspace/ui/artifact-page.tsx');
    const css = read('src/features/workspace/ui/workspace.module.css');
    for (const source of [project, artifact]) {
      expect(source).toContain('data-mobile-view={mobileView}');
      expect(source).toContain("setMobileView('assistant')");
      expect(source).toContain("setMobileView('result')");
    }
    expect(css).toContain('@media (max-width: 959px)');
    expect(css).toContain(".sessionLayout[data-mobile-view='assistant'] > .sessionResult");
    expect(css).toContain(".sessionLayout[data-mobile-view='result'] > .sessionAssistant");
  });

  it('shows only confirmed public progress and keeps terminal recovery actions truthful', () => {
    const session = read('src/features/runs/ui/assistant-session.tsx');
    const continuation = read('src/features/runs/ui/run-continuation.tsx');
    expect(session).toContain('setLiveEvent');
    expect(session).toContain('runText.actions[visibleLiveEvent.action]');
    expect(session).toContain("data.state === 'queued' || data.state === 'running'");
    expect(session).toContain('data.failure && retryStepId');
    expect(continuation).toContain("run.state === 'waiting_input' && run.failure === null");
    expect(session).not.toContain('technicalDetails');
    expect(session).not.toContain('text.technical');
    expect(session).not.toMatch(/chain.of.thought|modelMessages/i);
  });

  it('expands the same mounted editor and restores keyboard focus on exit', () => {
    const artifact = read('src/features/workspace/ui/artifact-page.tsx');
    const css = read('src/features/workspace/ui/workspace.module.css');
    expect(artifact).toContain('editorExpanded ? styles.sessionResultExpanded');
    expect(artifact).toContain("event.key === 'Escape'");
    expect(artifact).toContain("event.key === 'Tab'");
    expect(artifact).toContain('editorExpandButton.current?.focus');
    expect(artifact).toContain("window.dispatchEvent(new Event('resize'))");
    expect(css).toContain('.sessionResultExpanded');
    for (const editor of ['DocumentEditor', 'SheetEditor', 'DesignEditor', 'PlanEditor']) expect(artifact.match(new RegExp(`<${editor}`, 'g'))).toHaveLength(1);
  });

  it('keeps a persistent follow-up composer pinned to the exact saved artifact revision', () => {
    const session = read('src/features/runs/ui/assistant-session.tsx');
    const continuation = read('src/features/runs/ui/run-continuation.tsx');
    const artifact = read('src/features/workspace/ui/artifact-page.tsx');
    const runsCss = read('src/features/runs/ui/runs.module.css');
    expect(session).toContain('RunFollowupComposer');
    expect(session).toContain('prepareCurrentArtifact');
    expect(session).toContain('intent.input = { expectedEpoch: intent.epoch');
    expect(session).toContain("failure instanceof RunClientError && failure.status === 409");
    expect(session).toContain('command.current = undefined; setReload((value) => value + 1)');
    expect(session).toContain('runErrorText(commandError, runText)');
    expect(continuation).toContain('tirlik.run-followup-draft.v1');
    expect(continuation).not.toContain('Изменить задачу');
    expect(artifact).toContain('await session.flush()');
    expect(artifact).toContain('revision: current.snapshot.artifact.currentRevision');
    expect(artifact).toContain('revision > current.snapshot.artifact.currentRevision');
    expect(runsCss).toContain('grid-template-rows: auto minmax(0, 1fr) auto');
  });

  it('keeps authorized continuation history visible in bounded read-only pages', () => {
    const session = read('src/features/runs/ui/assistant-session.tsx');
    const historyStart = session.indexOf('history.runs.map((pastRun)');
    const historyEnd = session.indexOf('<article className={styles.currentTurn}', historyStart);
    const historyRender = session.slice(historyStart, historyEnd);
    expect(session).toContain('const HISTORY_PAGE_SIZE = 3');
    expect(session).toContain('const HISTORY_LIMIT = 12');
    expect(session).toContain('await transport.read(parentRunId, context)');
    expect(session).toContain('workspaceId !== context.workspaceId || ancestor.projectId !== context.projectId');
    expect(session).toContain('page.runs.reverse()');
    expect(session).toContain('loadEarlierHistory');
    expect(session).toContain('sessionResultHref(pastRun, result, resultHref)');
    expect(session).toContain('[401, 403, 410].includes(status)');
    expect(session).toContain('[401, 403, 404, 410].includes(status)');
    expect(session).toContain('setHistory(emptyHistory())');
    expect(historyRender).not.toContain('<DecisionPanel');
    expect(historyRender).not.toContain('<RunContinuation');
    expect(historyRender).not.toContain("mutate('resume'");
  });

  it('does not create a project, run, or artifact during a route GET', () => {
    for (const path of ['src/app/app/work/page.tsx', 'src/app/app/projects/[projectId]/page.tsx', 'src/app/app/projects/[projectId]/artifacts/[artifactId]/page.tsx']) {
      const source = read(path);
      expect(source).not.toContain('runClient.create');
      expect(source).not.toContain('artifactClient.create');
      expect(source).not.toContain('workspaceClient.create');
    }
  });
});
