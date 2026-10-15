import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

it('keeps operations server adapters out of the PlanEditor client graph', () => {
  const visited = new Set<string>();
  const visit = (path: string) => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = readFileSync(path, 'utf8'), tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const walk = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
        if (!typeOnly) {
          const target = node.moduleSpecifier.text;
          expect(target, path).not.toMatch(/^(?:node:|server-only$|next\/headers$|@\/server\/)/);
          expect(target, path).not.toMatch(/\/server(?:\/|$)/);
          if (target.startsWith('.') || target.startsWith('@/')) {
            const base = target.startsWith('@/') ? resolve(root, 'src', target.slice(2)) : resolve(dirname(path), target);
            const dependency = extname(base) ? base : ['.ts', '.tsx', '/index.ts'].map((extension) => base + extension).find(existsSync);
            if (!dependency) throw new Error(`Cannot resolve ${target} from ${path}`);
            if (!dependency.endsWith('.json') && !dependency.endsWith('.css')) visit(dependency);
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(tree);
  };
  visit(resolve(root, 'src/features/operations/index.ts'));
  expect(visited.size).toBeGreaterThan(8);
});
