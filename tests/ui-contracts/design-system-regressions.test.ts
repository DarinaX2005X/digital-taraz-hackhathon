import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('approved Tirlik interface contract', () => {
  it('keeps the approved nested geometry hierarchy in canonical tokens', () => {
    const tokens = JSON.parse(read('src/ui/tokens.json')) as { radius: Record<string, string> };
    expect(tokens.radius).toMatchObject({ panel: '28px', overlay: '28px', item: '22px', inset: '16px', control: '12px', tool: '10px' });
  });

  it('composes work as a task spine beside a quiet ledger instead of equal cards', () => {
    const page = read('src/features/workspace/ui/work-page.tsx');
    const css = read('src/features/workspace/ui/workspace.module.css');
    expect(page).toContain('className={styles.workBoard}');
    expect(page).toContain('className={styles.workComposer}');
    expect(page).toContain('className={styles.workLedger}');
    expect(css).toContain('background: var(--color-deep-surface)');
    expect(css).toContain('.projects { display: grid; grid-template-columns: minmax(0, 1fr)');
    expect(css).not.toContain('.workComposer::after');
  });

  it('keeps the assistant and editable result as distinct, connected surfaces', () => {
    const workspace = read('src/features/workspace/ui/workspace.module.css');
    const runs = read('src/features/runs/ui/runs.module.css');
    expect(workspace).toContain('.sessionLayout { display: grid');
    expect(workspace).toContain('gap: 0');
    expect(workspace).toContain('background: var(--color-paper)');
    expect(runs).toContain('background: var(--color-deep-surface)');
    expect(runs).not.toMatch(/\.assistantSession[^}]*box-shadow/);
  });

  it('uses overlays for elevation while dense editors remain flat', () => {
    const controls = read('src/ui/controls.css');
    const operations = read('src/features/operations/ui/plan.module.css');
    const sheets = read('src/features/sheets/ui/sheets.module.css');
    expect(controls).toContain('.tl-dialog');
    expect(controls).toContain('box-shadow: var(--shadow-overlay)');
    expect(operations).toContain('.editor { border-radius: var(--radius-item); box-shadow: none;');
    const sheetCanvas = sheets.slice(sheets.indexOf('.canvas {'), sheets.indexOf('}', sheets.indexOf('.canvas {')));
    expect(sheetCanvas).toContain('background: var(--color-paper)');
    expect(sheetCanvas).not.toContain('box-shadow');
  });

  it('retains touch, focus, narrow-layout, and reduced-motion states', () => {
    const foundation = read('src/ui/foundation.css');
    const controls = read('src/ui/controls.css');
    const workspace = read('src/features/workspace/ui/workspace.module.css');
    expect(foundation).toContain('min-block-size: var(--size-touch)');
    expect(foundation).toContain(':focus-visible');
    expect(controls).toContain('@media (hover: hover)');
    expect(workspace).toContain('@media (max-width: 767px)');
    expect(workspace).toContain('@media (prefers-reduced-motion: reduce)');
  });

});
