import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

it("keeps server modules and environment access out of the locale and control client graphs", () => {
  const visited = new Set<string>();
  const visit = (path: string) => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = readFileSync(path, "utf8");
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const walk = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && node.getText(tree).startsWith("process.env")) throw new Error(`Environment access in ${path}`);
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
        if (!typeOnly) {
          const target = node.moduleSpecifier.text;
          expect(target, path).not.toMatch(/^(?:node:|server-only$|next\/headers$|@\/server\/)/);
          if (target.startsWith(".") || target.startsWith("@/")) {
            const base = target.startsWith("@/") ? resolve(root, "src", target.slice(2)) : resolve(dirname(path), target);
            const dependency = extname(base) ? base : [".ts", ".tsx", "/index.ts"].map((extension) => base + extension).find(existsSync);
            if (!dependency) throw new Error(`Cannot resolve ${target} from ${path}`);
            expect(dependency).not.toMatch(/[\\/]server[\\.]/);
            if (!dependency.endsWith(".json")) visit(dependency);
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(tree);
  };
  visit(resolve(root, "src/i18n/provider.tsx"));
  visit(resolve(root, "src/i18n/index.ts"));
  visit(resolve(root, "src/ui/index.ts"));
  expect(visited.size).toBeGreaterThan(5);
});

it("does not key editor children by locale or navigate on language selection", () => {
  const path = resolve(root, "src/i18n/provider.tsx");
  const tree = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  let rendersChildren = false;
  const walk = (node: ts.Node) => {
    if (ts.isJsxAttribute(node)) expect(node.name.getText(tree)).not.toBe("key");
    if (ts.isJsxExpression(node) && node.expression?.getText(tree) === "children") rendersChildren = true;
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) expect(node.moduleSpecifier.text).not.toBe("next/navigation");
    ts.forEachChild(node, walk);
  };
  walk(tree);
  expect(rendersChildren).toBe(true);
});
