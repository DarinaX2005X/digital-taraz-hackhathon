import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const ui = resolve(root, "src/features/identity/ui");
const read = (file: string) => readFileSync(resolve(ui, file), "utf8");
function parse(file: string) {
  const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> = [];
  const calls: ts.CallExpression[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, walk);
  };
  walk(tree);
  return { tree, elements, calls, named: (name: string) => elements.filter((node) => node.tagName.getText(tree) === name) };
}
function attribute(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  const prop = node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText() === name);
  if (!prop || !ts.isJsxAttribute(prop)) return undefined;
  if (!prop.initializer) return "true";
  if (ts.isStringLiteral(prop.initializer)) return prop.initializer.text;
  return ts.isJsxExpression(prop.initializer) ? prop.initializer.expression?.getText() : prop.initializer.getText();
}

describe("identity source contracts, without browser or rendering", () => {
  it("keeps server dependencies and secrets out of the complete UI import graph", () => {
    const visited = new Set<string>();
    const visit = (path: string) => {
      if (visited.has(path) || [".css", ".json"].includes(extname(path))) return;
      visited.add(path);
      const source = readFileSync(path, "utf8");
      const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const walk = (node: ts.Node) => {
        if (ts.isPropertyAccessExpression(node)) expect(node.getText(tree), path).not.toMatch(/^process\.env/);
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
          if (!typeOnly) {
            const target = node.moduleSpecifier.text;
            expect(target, path).not.toMatch(/^(?:node:|server-only$|next\/headers$|@\/server\/|better-auth|nodemailer)/);
            if (target.startsWith(".") || target.startsWith("@/")) {
              const base = target.startsWith("@/") ? resolve(root, "src", target.slice(2)) : resolve(dirname(path), target);
              const dependency = extname(base) ? base : [".ts", ".tsx", "/index.ts"].map((suffix) => base + suffix).find(existsSync);
              if (!dependency) throw new Error(`Unresolved ${target} in ${path}`);
              expect(dependency).not.toMatch(/[\\/]server[\\.]/);
              visit(dependency);
            }
          }
        }
        ts.forEachChild(node, walk);
      };
      walk(tree);
    };
    visit(resolve(ui, "index.ts"));
    expect(visited.size).toBeGreaterThan(20);
  });

  it("does not persist credentials or tokens in browser storage, cookies or telemetry", () => {
    for (const file of readdirSync(ui).filter((file) => /\.tsx?$/.test(file))) {
      const { tree, calls } = parse(file);
      for (const call of calls) expect(call.expression.getText(tree), file).not.toMatch(/(?:localStorage|sessionStorage|console\.|sendBeacon|document\.cookie)/);
      expect(read(file), file).not.toContain("dangerouslySetInnerHTML");
      expect(read(file), file).not.toMatch(/document\.cookie\s*=/);
    }
  });

  it("leaves email verification and password reset mutations behind explicit user actions", () => {
    const { calls, tree } = parse("recovery.tsx");
    expect(calls.filter((call) => call.expression.getText(tree) === "useEffect")).toHaveLength(0);
    const verify = parse("recovery.tsx").named("Button").find((node) => attribute(node, "onClick")?.includes("identityClient.verifyEmail"));
    expect(verify).toBeDefined();
    expect(read("recovery.tsx")).toContain("onSubmit={submit}");
    expect(read("credentials.tsx")).not.toContain("restoreIntent(");
    expect(attribute(parse("recovery.tsx").named("ResetPasswordScreen")[0]!, "key")).toBe('props.token ?? "request"');
    expect(attribute(parse("recovery.tsx").named("VerifyEmailScreen")[0]!, "key")).toBe('props.token ?? "request"');
  });

  it("uses native forms, field associations and password-manager hints", () => {
    for (const file of ["credentials.tsx", "recovery.tsx", "settings.tsx", "team-dialogs.tsx", "account-deletion.tsx"]) {
      const source = parse(file);
      expect(source.named("form").length).toBeGreaterThan(0);
      for (const form of source.named("form")) expect(attribute(form, "onSubmit")).toBe("submit");
      for (const field of [...source.named("InputField"), ...source.named("PasswordField")]) {
        expect(attribute(field, "label"), file).toBeDefined();
        expect(attribute(field, "name"), file).toBeDefined();
        expect(attribute(field, "autoComplete"), file).toBeDefined();
      }
    }
    const common = parse("common.tsx");
    const input = common.named("input")[0]!;
    expect(attribute(input, "aria-describedby")).toContain("fieldDescriptionIds");
    expect(attribute(input, "aria-invalid")).toBeDefined();
    expect(attribute(input, "type")).toContain('"password"');
    expect(attribute(common.named("IconButton")[0]!, "aria-pressed")).toBe("visible");
    expect(read("credentials.tsx")).toContain('"new-password" : "current-password"');
  });

  it("does not key form state by language, but clears the private settings tree for a different account", () => {
    for (const file of readdirSync(ui).filter((file) => file.endsWith(".tsx"))) {
      for (const element of parse(file).elements) expect(attribute(element, "key") ?? "", file).not.toMatch(/locale|language/);
    }
    expect(attribute(parse("settings.tsx").named("SettingsContent")[0]!, "key")).toBe("viewer.user.id");
    expect(read("identity-locale-provider.tsx")).not.toContain("next/navigation");
    expect(read("credentials.tsx")).toContain("{open &&");
  });

  it("uses guarded shared dialogs and distinguishes profile navigation from sign-out", () => {
    const menu = parse("account-menu.tsx");
    const items = menu.named("Ariakit.MenuItem");
    expect(attribute(items[0]!, "render")).toContain("/settings#profile");
    expect(attribute(items[0]!, "onClick")).toBeUndefined();
    expect(attribute(items.at(-1)!, "onClick")).toContain("setSignOutOpen(true)");
    expect(menu.named("DialogClose")).toHaveLength(1);
    expect(attribute(menu.named("Dialog")[0]!, "initialFocus")).toBe("cancel");
    expect(read("account-menu.tsx")).toContain("beforeSignOut");
    expect(read("account-menu.tsx")).toContain("account.clear()");
    expect(read("account-menu.tsx")).toContain("asIdentityFailure(error).status === 401");
    expect(items.some((item) => attribute(item, "render")?.includes("/settings/team"))).toBe(true);
  });

  it("keeps invitation acceptance behind a named explicit action and rejects an invalid token before authentication", () => {
    const invitation = parse("invitation.tsx");
    for (const effect of invitation.calls.filter((call) => call.expression.getText(invitation.tree) === "useEffect")) expect(effect.arguments[0]?.getText(invitation.tree)).not.toContain("acceptInvitation");
    const accept = invitation.named("Button").find((node) => attribute(node, "onClick")?.includes("join()"));
    expect(accept).toBeDefined();
    expect(read("invitation.tsx")).toContain('if (!InvitationTokenSchema.safeParse(token).success) return <IdentityFrame');
    expect(read("invitation.tsx")).not.toContain('t("identity.invitation.wrongAccount")');
    expect(read("invitation.tsx")).toContain('const unavailable = !valid || preview.failure?.status === 404 || accept.failure?.status === 404');
    expect(read("invitation.tsx")).not.toMatch(/targetEmail|recipientEmail|invitedEmail/);
  });

  it("retains an explicit team selection in guest and expired-session auth dialogs", () => {
    const team = parse("team.tsx");
    const dialogs = team.named("AuthDialog");
    expect(dialogs).toHaveLength(2);
    for (const dialog of dialogs) {
      expect(attribute(dialog, "returnTo")).toContain("/settings/team?workspace=");
      expect(attribute(dialog, "onAuthenticated")).not.toMatch(/createWorkspace|updateMember|revokeMember|createInvitation|acceptInvitation/);
    }
    expect(attribute(team.named("TeamContent")[0]!, "key")).toBe("viewer.user.id");
    expect(attribute(team.named("TeamWorkspace")[0]!, "key")).toBe("selectedId");
  });

  it("uses server action inventories and clears denied cached team data instead of revealing it during retry", () => {
    const team = read("team.tsx");
    for (const action of ["update", "transfer", "revoke"]) expect(team).toContain(`member.allowedActions.${action}`);
    expect(team).toContain("current.allowedActions.invite");
    expect(team).toContain("[403, 404, 409].includes(status)) { setTeam(undefined); setAction(undefined); }");
    const modal = read("team-dialogs.tsx");
    expect(modal).toContain("expectedAuthzVersion: revision");
    expect(modal).toContain("revision !== team.workspace.authzVersion || conflict");
    expect(modal).toContain("setConflict(true)");
    expect(modal).toContain("setConflict(false)");
    expect(modal).not.toContain("actorMembership.authzVersion");
  });

  it("requires ownership review, a current password and consent before deletion, with an uncertain-outcome gate", () => {
    const deletion = parse("account-deletion.tsx");
    const source = read("account-deletion.tsx");
    const password = deletion.named("PasswordField")[0]!;
    expect(attribute(password, "autoComplete")).toBe("current-password");
    expect(attribute(password, "error")).toContain("passwordVariables");
    const confirmation = deletion.named("CheckboxField").find((node) => attribute(node, "name") === "confirmDeletion");
    expect(confirmation).toBeDefined();
    expect(attribute(confirmation!, "required")).toBe("true");
    expect(source).toContain('if (stage === "choices") { setStage("confirm"); return; }');
    expect(source).toContain('confirmation: "DELETE_ACCOUNT"');
    expect(source).toContain("if (!preview || busy || stale || uncertain || sessionMissing) return;");
    expect(source).toContain("if (!signal.aborted && failure.status === 0) setUncertain(true)");
    expect(source).toContain("identity.deletion.sessionUnavailable");
    for (const effect of deletion.calls.filter((call) => call.expression.getText(deletion.tree) === "useEffect")) expect(effect.arguments[0]?.getText(deletion.tree)).not.toContain("deleteAccount");
    expect(attribute(deletion.named("Dialog")[0]!, "initialFocus")).toBe("cancelButton");
    expect(read("settings.tsx")).toContain("setDeleted(result); setViewer(undefined); account.clear()");
  });

  it("keeps shell, future products and social sign-in out of the account entry", () => {
    const entry = parse("entry.tsx");
    const links = entry.named("Link").map((node) => attribute(node, "href"));
    expect(links).toEqual(["/settings", "/sign-in", "/sign-up"]);
    expect(read("entry.tsx")).not.toMatch(/canvas|iframe|dashboard|coming.soon/i);
  });

  it("uses bounded responsive geometry and only shared design variables", () => {
    const css = read("identity.module.css");
    const tokens = readFileSync(resolve(root, "src/ui/tokens.css"), "utf8");
    const declared = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    for (const match of css.matchAll(/var\((--[\w-]+)/g)) expect(declared.has(match[1]), match[1]).toBe(true);
    expect(css).toContain("width: min(100%, 440px)");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("min-height: var(--size-touch)");
    expect(css).not.toMatch(/font-size:\s*[^;]*v(?:w|h)|letter-spacing:\s*-|linear-gradient|radial-gradient/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
