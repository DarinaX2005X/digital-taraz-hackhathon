import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineNotice, DataSurface } from "../../src/ui/surface";
import { Progress, ProgressSteps } from "../../src/ui/progress";

const readUi = (file: string) => readFileSync(new URL(`../../src/ui/${file}`, import.meta.url), "utf8");

describe("shared visual primitives", () => {
  it("uses a native determinate progress value and leaves unknown work indeterminate", () => {
    const measured = renderToStaticMarkup(<Progress label="Export" value={32} max={80} detail="32 / 80" />);
    expect(measured).toContain('<progress class="tl-progress__track" max="80" value="32" aria-label="Export"></progress>');
    const unknown = renderToStaticMarkup(<Progress label="Preparing" />);
    expect(unknown).toContain("<progress");
    expect(unknown).not.toMatch(/<progress[^>]+ value=/);
    expect(unknown).not.toContain("%");
    expect(renderToStaticMarkup(<Progress label="Overreported" value={90} max={80} />)).toContain('value="80"');
    expect(renderToStaticMarkup(<Progress label="Invalid maximum" value={-2} max={0} />)).toContain('max="100" value="0"');
  });

  it("represents workflow progress as stable named steps", () => {
    const html = renderToStaticMarkup(<ProgressSteps label="Export steps" currentId="review" items={[
      { id: "draft", label: "Draft" }, { id: "review", label: "Review" }, { id: "send", label: "Send" },
    ]} />);
    expect(html).toContain('<ol aria-label="Export steps"');
    expect(html).toContain('data-state="complete"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('data-state="upcoming"');
  });

  it("keeps dense data flat and persistent errors announced beside their cause", () => {
    const data = renderToStaticMarkup(<DataSurface aria-label="Amounts"><table><tbody><tr><td>24</td></tr></tbody></table></DataSurface>);
    expect(data).toContain('<section aria-label="Amounts" class="tl-data-surface ">');
    const danger = renderToStaticMarkup(<InlineNotice tone="danger" title="Could not save">Try again.</InlineNotice>);
    expect(danger).toContain('role="alert"');
    expect(danger).toContain("Try again.");
    const controls = readUi("controls.css");
    expect(controls.slice(controls.indexOf(".tl-data-surface"), controls.indexOf(".tl-inline-notice"))).not.toContain("box-shadow");
  });

  it("builds menus on Ariakit's focus and keyboard model", () => {
    const source = readUi("menu.tsx");
    for (const contract of ["useMenuStore", "Ariakit.MenuButton", "Ariakit.Menu", "Ariakit.MenuItem", "portal"]) expect(source).toContain(contract);
    expect(source).toContain("ComponentProps<typeof Ariakit.MenuItem>");
  });

  it("keeps every established export while adding the approved primitives", () => {
    const barrel = readUi("index.ts");
    for (const name of ["Button", "InputField", "Combobox", "Dialog", "Tabs", "TableFrame", "SaveStatus", "ToastProvider", "Toolbar", "LocaleSelect", "ProductHeader", "Menu", "Progress", "ProgressSteps", "Surface", "DataSurface", "InlineNotice"]) {
      expect(barrel, name).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});
