import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { proveFormats } from "./formats.mjs";
import { formatLicenses } from "./sources.mjs";

const directory = fileURLToPath(new URL("../../tests/preflight/evidence/", import.meta.url));
const result = await proveFormats();
await mkdir(directory, { recursive: true });
for (const [name, bytes] of Object.entries(result.files)) await writeFile(path.join(directory, name), bytes);
await writeFile(path.join(directory, "formats.json"), `${JSON.stringify({ recordedAt: new Date().toISOString(), ...result.evidence, licenses: await formatLicenses() }, null, 2)}\n`);
console.log(JSON.stringify({ status: "passed", formulas: result.evidence.formulas.results.length, office: ["xlsx", "docx", "pdf"], fabric: true, forecast: true, uiVerified: false, evidence: "tests/preflight/evidence/formats.json" }));
