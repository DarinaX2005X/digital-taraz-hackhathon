import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

export async function formatLicenses() {
  const names = ["@univerjs/core", "@univerjs/engine-formula", "@univerjs/sheets", "@univerjs/sheets-formula", "@univerjs/docs", "@univerjs/engine-render", "@univerjs/sheets-numfmt", "fabric", "exceljs", "docx", "pdfkit", "mammoth", "pdfjs-dist", "sharp", "jszip", "arima", "simple-statistics"];
  const packages = [];
  for (const name of names) {
    const info = JSON.parse(await readFile(path.join(root, "node_modules", name, "package.json"), "utf8"));
    packages.push({ name, version: info.version, declaredLicense: info.license, source: `https://registry.npmjs.org/${name}/${info.version}` });
  }
  return {
    packages,
    boundaries: [
      { capability: "Univer data-only formulas", source: "https://docs.univer.ai/guides/sheets/getting-started/node", result: "OSS Apache-2.0 plugins calculate in Node without creating a UI surface." },
      { capability: "Office conversion", source: "https://docs.univer.ai/guides/sheets/features/import-export", result: "Univer exchange APIs require conversion backend and @univerjs-pro plugins. Proof uses ExcelJS with cached results supplied by the OSS formula engine. No Pro service installed or purchased." },
      { capability: "Fabric editable objects", source: "https://www.fabricjs.com/docs/using-custom-properties/", result: "Object serialization preserves stable IDs and bindings. Rendering objects are not the authoritative business database; SVG fidelity and UI composition are not established." },
      { capability: "Forecast wrapper", source: "https://github.com/zemlyansky/arima", result: "MIT arima wrapper embeds CTSA; fixed ARIMA parameters, WASM memory destroyed after use. AutoARIMA avoided due upstream limitations." },
      { capability: "Underlying CTSA notice", source: "https://github.com/rafat/ctsa/blob/master/COPYRIGHT", result: "Underlying CTSA uses BSD-3-Clause. Its notice is absent from the installed arima tarball; deployment/distribution must retain CTSA copyright, conditions and disclaimer in third-party notices. Wrapper MIT alone is not the whole license inventory." },
      { capability: "Font embedding", source: "https://github.com/notofonts/noto-fonts/blob/ffebf8c1ee449e544955a7e813c54f9b73848eac/LICENSE", result: "Noto Sans OFL-1.1 in public/fonts/noto-sans/OFL.txt; font manifest pins revision and hashes. No commercial font copied." },
      { capability: "XLSX authoring", source: "https://github.com/exceljs/exceljs", result: "ExcelJS writes formula strings and supplied cached values; it does not compute formulas. x14 conditional formatting UUID v4 path verified with scoped uuid11.1.1 override." },
    ],
    unverified: ["Full Office layout fidelity", "Browser editor interaction", "Fabric font metrics and visual composition", "Forecast accuracy on real business data", "All transitive distribution notices outside these direct libraries"],
  };
}
