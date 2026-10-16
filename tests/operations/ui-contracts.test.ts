import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { operationsCopies } from '@/features/operations/locales';

describe('operations locale and interaction contract', () => {
  it('ships matching ru/kk/en catalogs', () => {
    const keys = Object.keys(operationsCopies.ru).sort();
    expect(Object.keys(operationsCopies.kk).sort()).toEqual(keys);
    expect(Object.keys(operationsCopies.en).sort()).toEqual(keys);
    expect(operationsCopies.ru.noAccountNote).toContain('Аккаунт не нужен');
    expect(operationsCopies.kk.noAccountNote).toContain('Аккаунт қажет емес');
  });

  it('keeps date-field alternatives and a list-first narrow layout in source', async () => {
    const editor = await readFile(new URL('../../src/features/operations/ui/plan-editor.tsx', import.meta.url), 'utf8');
    const css = await readFile(new URL('../../src/features/operations/ui/plan.module.css', import.meta.url), 'utf8');
    expect(editor).toContain("useState<View>('list')");
    expect(editor).toContain('type="date"');
    expect(editor).toContain('type="datetime-local"');
    expect(editor).toContain("role=\"tablist\"");
    expect(css).toContain('@media (max-width: 680px)');
    expect(css).toContain('.listHeader { display: none; }');
    expect(editor).toContain('t.buildCandidate');
  });

  it('keeps a checked scheduling candidate separate from apply and persists task locks', async () => {
    const editor = await readFile(new URL('../../src/features/operations/ui/plan-editor.tsx', import.meta.url), 'utf8');
    const commands = await readFile(new URL('../../src/features/operations/domain/commands.ts', import.meta.url), 'utf8');
    expect(editor).toContain('setProposal({ result, baseHash: currentHash })');
    expect(editor).toContain('async function applyProposal()');
    expect(editor).toContain('selectedProposal.baseHash !== hashJson(state.content');
    expect(editor).toContain('controller.command(async (base)');
    expect(editor).toContain('selectedProposal.baseHash !== hashJson(base.content');
    expect(editor).toContain('entryLockCommand(base, entry.id');
    expect(commands).toContain("op: 'lock'");
    expect(commands).toContain('locked ? { locked: true');
  });

  it('does not silently repin availability when resource metadata changes', async () => {
    const drawer = await readFile(new URL('../../src/features/operations/ui/resource-drawer.tsx', import.meta.url), 'utf8');
    expect(drawer).toContain('previousAvailabilityVersionId');
    expect(drawer).not.toContain('resourceUpdated(resource: WorkResource) {\n    setResources((current) => current.map((item) => item.id === resource.id ? resource : item));\n    onChange(');
  });
});
