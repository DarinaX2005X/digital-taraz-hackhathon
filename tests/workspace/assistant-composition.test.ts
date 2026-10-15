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
    expect(css).toContain('@media (max-width: 1199px)');
    expect(css).toContain(".sessionLayout[data-mobile-view='assistant'] > .sessionResult");
    expect(css).toContain(".sessionLayout[data-mobile-view='result'] > .sessionAssistant");
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
