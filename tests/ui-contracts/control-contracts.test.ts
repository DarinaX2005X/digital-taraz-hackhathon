import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { fieldDescriptionIds } from "../../src/ui/field";

const read = (file: string) => readFileSync(new URL(`../../src/ui/${file}`, import.meta.url), "utf8");
function parse(file: string) {
  const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> = [];
  const walk = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
    ts.forEachChild(node, walk);
  };
  walk(tree);
  return { tree, elements, named: (name: string) => elements.filter((node) => node.tagName.getText(tree) === name) };
}
function attribute(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  const prop = node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText() === name);
  if (!prop || !ts.isJsxAttribute(prop)) return undefined;
  if (!prop.initializer) return "true";
  if (ts.isStringLiteral(prop.initializer)) return prop.initializer.text;
  return ts.isJsxExpression(prop.initializer) ? prop.initializer.expression?.getText() : prop.initializer.getText();
}

describe("source-level accessibility contracts (not browser validation)", () => {
  it("connects field descriptions without inventing missing IDs", () => {
    expect(fieldDescriptionIds("amount", {})).toBeUndefined();
    expect(fieldDescriptionIds("amount", { hint: "Hint", error: "Error", unit: "KZT", describedBy: "context" }))
      .toBe("context amount-hint amount-unit amount-error");
    expect(fieldDescriptionIds("amount", { error: "" })).toBeUndefined();
    const field = parse("field.tsx");
    expect(field.named("label").every((label) => attribute(label, "htmlFor") === "id")).toBe(true);
    for (const control of [...field.named("input"), ...field.named("textarea"), ...field.named("select")]) {
      expect(attribute(control, "id")).toBe("id");
      expect(attribute(control, "aria-describedby")).toContain("fieldDescriptionIds");
      expect(attribute(control, "aria-invalid")).toBeDefined();
    }
  });

  it("names icons independently of visual tooltips and protects pending actions", () => {
    const { named } = parse("button.tsx");
    const buttons = named("Ariakit.Button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(attribute(button, "disabled")).toBe("disabled || pending");
      expect(attribute(button, "aria-busy")).toBe("pending || undefined");
      expect(attribute(button, "aria-describedby")).toBe("describedBy");
    }
    expect(attribute(buttons[1]!, "aria-label")).toBe("label");
    expect(named("Ariakit.Tooltip")).toHaveLength(1);
    expect(named("Ariakit.TooltipAnchor")).toHaveLength(1);
  });

  it("keeps a readable pending label without exposing two accessible names", () => {
    const source = read("button.tsx");
    const spans = parse("button.tsx").named("span");
    expect(spans.some((span) => attribute(span, "aria-hidden") === "pending && pendingLabel !== undefined ? true : undefined")).toBe(true);
    expect(spans.some((span) => attribute(span, "aria-hidden") === "!pending ? true : undefined")).toBe(true);
    expect(source).toContain("pendingLabel?: ReactNode");
  });

  it("shares the product header while keeping its home target named and configurable", () => {
    const header = parse("product-header.tsx");
    const home = header.named("Link")[0]!;
    expect(attribute(home, "href")).toBe("homeHref");
    expect(attribute(home, "aria-label")).toContain("homeLabel");
    expect(attribute(header.named("Image")[0]!, "alt")).toBe("");
    expect(read("product-header.tsx")).not.toContain("identity");
    const locale = parse("locale-select.tsx").named("SelectField")[0]!;
    expect(attribute(locale, "label")).toBe('t("common.navigation.language")');
    expect(read("locale-select.tsx")).toContain("compact?: boolean");
    expect(attribute(parse("locale-select.tsx").named("Button")[0]!, "onClick")).toBe("() => setLocale(locale)");
  });

  it("retains both dialog trees and sends all dismissal through the dirty guard", () => {
    const { named } = parse("dialog.tsx");
    const dialogs = named("Ariakit.Dialog");
    expect(dialogs).toHaveLength(2);
    const [editor, warning] = dialogs;
    for (const dialog of dialogs) {
      expect(attribute(dialog, "modal")).toBe("true");
      expect(attribute(dialog, "unmountOnHide")).toBe("false");
    }
    expect(attribute(editor!, "initialFocus")).toBe("initialFocus");
    expect(attribute(editor!, "finalFocus")).toBe("returnFocus");
    expect(attribute(editor!, "onClose")).toContain("event.preventDefault()");
    expect(attribute(editor!, "onClose")).toContain("dirty");
    expect(attribute(editor!, "onClose")).not.toContain("onOpenChange(false)");
    expect(attribute(warning!, "role")).toBe("alertdialog");
    expect(attribute(warning!, "hideOnInteractOutside")).toBe("false");
    expect(attribute(warning!, "initialFocus")).toBe("keepEditingRef");
    expect(attribute(warning!, "onClose")).toContain('"keep-editing"');
    let ancestor: ts.Node | undefined = warning?.parent.parent;
    while (ancestor && ancestor !== editor?.parent) ancestor = ancestor.parent;
    expect(ancestor).toBe(editor?.parent);
    expect(named("Ariakit.DialogDismiss")).toHaveLength(3);
  });

  it("preserves tab panels and uses stable record IDs instead of translated labels", () => {
    const { named } = parse("tabs.tsx");
    expect(attribute(named("Ariakit.TabPanel")[0]!, "unmountOnHide")).toBe("false");
    expect(attribute(named("Ariakit.TabPanel")[0]!, "key")).toBe("item.id");
    expect(attribute(named("Ariakit.Tab")[0]!, "key")).toBe("item.id");
    const combobox = parse("combobox.tsx");
    const option = combobox.named("Ariakit.ComboboxItem")[0]!;
    expect(attribute(option, "key")).toBe("option.id");
    expect(attribute(option, "value")).toBe("option.id");
    expect(attribute(option, "setValueOnClick")).toBe("false");
    expect(attribute(option, "selectValueOnClick")).toBe("false");
    expect(attribute(combobox.named("Ariakit.Combobox")[0]!, "autoSelect")).toBe("false");
    const hidden = combobox.named("input").find((node) => attribute(node, "type") === "hidden");
    expect(attribute(hidden!, "value")).toBe('value?.id ?? ""');
  });

  it("uses the latest query after clear/refocus and keeps recovery controls alive until their click", () => {
    const source = read("combobox.tsx");
    expect(source).toContain('controller.search(value ? "" : controller.getSnapshot().query, true)');
    const popover = parse("combobox.tsx").named("Ariakit.ComboboxPopover")[0]!;
    expect(attribute(popover, "hideOnInteractOutside")).toContain("fieldRef.current?.contains(event.target)");
    expect(source).toContain('t("common.fields.noOptions")');
    expect(source).toContain('t("common.fields.noMatches")');
    expect(source).toContain('t("common.errors.loadFailed")');
  });

  it("does not key form/editor trees by locale or navigate when labels change", () => {
    for (const file of ["combobox.tsx", "dialog.tsx", "tabs.tsx", "toast.tsx", "locale-select.tsx", "field.tsx"]) {
      const { elements, tree } = parse(file);
      for (const element of elements) {
        if (element.tagName.getText(tree) === "option") {
          expect(attribute(element, "key")).toBe("language");
          continue;
        }
        expect(attribute(element, "key") ?? "").not.toMatch(/locale|language/);
      }
      const imports = tree.statements.filter(ts.isImportDeclaration).map((statement) => statement.moduleSpecifier.getText(tree));
      expect(imports).not.toContain('"next/navigation"');
    }
  });

  it("pauses toast expiry on hover/focus and gives errors a persistent alert", () => {
    const source = read("toast.tsx");
    expect(source).toContain("const paused = hovered || focused");
    expect(source).toContain("if (paused || remaining.current === null) return");
    expect(source).toContain("clearTimeout(timer)");
    const { elements } = parse("toast.tsx");
    const live = elements.find((node) => attribute(node, "role") === 'notice.tone === "error" ? "alert" : "status"');
    expect(live).toBeDefined();
    expect(attribute(live!, "aria-atomic")).toBe("true");
  });

  it("makes the table own its scrolling region without replacing its semantics", () => {
    const { named } = parse("table-frame.tsx");
    const frame = named("div")[0]!;
    expect(attribute(frame, "role")).toBe("region");
    expect(attribute(frame, "aria-label")).toBe("label");
    expect(attribute(frame, "tabIndex")).toBe("0");
  });
});

describe("CSS source constraints", () => {
  const css = read("controls.css");
  const block = (selector: string) => css.slice(css.indexOf(`${selector} {`) + selector.length + 2).split("}", 1)[0]!;

  it("loads the controls with the shared foundation and uses defined semantic variables", () => {
    expect(read("foundation.css")).toContain('@import "./controls.css"');
    const declared = new Set([...read("tokens.css").matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    declared.add("--table-min-width");
    declared.add("--popover-available-height");
    for (const match of css.matchAll(/var\((--[\w-]+)/g)) expect(declared.has(match[1]), match[1]).toBe(true);
  });

  it("reserves icon/toolbar geometry and keeps pending labels in layout", () => {
    expect(block(".tl-icon-button")).toContain("inline-size: var(--size-touch)");
    expect(block(".tl-icon-button")).toContain("block-size: var(--size-touch)");
    expect(block(".tl-toolbar")).toContain("min-block-size: var(--size-header)");
    expect(block(".tl-button__progress")).toContain("position: absolute");
    expect(block(".tl-button__label")).toContain("display: grid");
    expect(block('.tl-button__label > [aria-hidden="true"]')).toContain("visibility: hidden");
    expect(block(".tl-button__icon")).toContain("block-size: var(--size-icon)");
    expect(css).not.toMatch(/\.tl-button\[data-pending\] \.tl-button__label[\s,{]/);
    expect(block(".tl-combobox__clear")).toContain("var(--size-touch)");
    expect(block(".tl-checkbox-field__target")).toContain("block-size: var(--size-touch)");
  });

  it("removes empty field message tracks but preserves compact language labels", () => {
    expect(block(".tl-field__messages:empty")).toContain("display: none");
    expect(block(".tl-locale--compact .tl-field__label")).toContain("clip-path: inset(50%)");
    expect(block(".tl-locale--compact .tl-field__label")).not.toContain("display: none");
  });

  it("keeps link hover colors out of button variants", () => {
    const foundation = read("foundation.css");
    expect(foundation).toContain("a:not(.tl-button):hover");
    expect(foundation).not.toMatch(/(?:^|\n)\s*a:hover\s*\{/);
    expect(block(".tl-button--primary")).toContain("color: var(--color-on-action)");
    expect(block('.tl-button--primary:not(:disabled, [aria-disabled="true"]):hover')).toContain("background: var(--color-action-hover)");
  });

  it("bounds overlays and intrinsic wide tables, preserves hidden panels, and disables motion", () => {
    expect(block(".tl-dialog")).toContain("100dvh");
    expect(block(".tl-dialog__body")).toContain("overflow: auto");
    expect(block(".tl-table-frame")).toContain("overflow: auto");
    expect(block(".tl-tabs__list")).toContain("overflow-x: auto");
    expect(css).toMatch(/\.tl-dialog\[hidden\],[\s\S]+?\.tl-tabs__panel\[hidden\],[\s\S]+?display: none/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]+?\.tl-spin,[\s\S]+?\.tl-skeleton \{ animation: none;/);
    expect(css).not.toMatch(/font-size:\s*[^;]*v(?:w|h)|letter-spacing:\s*-/);
    for (const match of css.matchAll(/border-radius:\s*([^;]+);/g)) expect(match[1]).toMatch(/^(?:0|inherit|var\(--radius-(?:tool|control|counter|inset|item|overlay)\))$/);
  });

  it("uses stable press feedback and keeps opaque reading surfaces", () => {
    expect(block('.tl-button:not(:disabled, [aria-disabled="true"]):active')).toContain("transform: scale(0.985)");
    expect(block(".tl-toast")).not.toContain("border-inline-start-width");
    const foundation = read("foundation.css");
    expect(block(".tl-button")).toContain("var(--motion-press)");
    expect(foundation).not.toMatch(/backdrop-filter|color-mix\([^)]*transparent/);
  });
});
