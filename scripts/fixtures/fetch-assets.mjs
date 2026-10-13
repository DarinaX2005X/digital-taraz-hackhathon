import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { PHOTO_SOURCES } from "./definitions.mjs";

const assetDirectory = fileURLToPath(new URL("../../fixtures/business/assets/", import.meta.url));
await mkdir(assetDirectory, { recursive: true });
const evidence = [];

for (const source of PHOTO_SOURCES) {
  if (evidence.length > 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
  const response = await fetch(source.url, {
    signal: AbortSignal.timeout(45_000),
    headers: { "User-Agent": "TirlikSyntheticFixtures/1.0 (public licensed educational assets)" },
  });
  if (!response.ok) throw new Error(`Asset ${source.id}: HTTP ${response.status}`);
  const original = Buffer.from(await response.arrayBuffer());
  if (original.length !== source.sourceBytes || createHash("sha1").update(original).digest("hex") !== source.sha1) {
    throw new Error(`Asset ${source.id} changed: verify source and licence before updating the pin.`);
  }
  const { data, info } = await sharp(original, { limitInputPixels: 20_000_000 })
    .rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 86, chromaSubsampling: "4:4:4" }).toBuffer({ resolveWithObject: true });
  const file = `assets/${source.id}.jpg`;
  await writeFile(new URL(`../../fixtures/business/${file}`, import.meta.url), data);
  evidence.push({
    ...source, file, mediaType: "image/jpeg", width: info.width, height: info.height, bytes: data.length,
    originalSha256: createHash("sha256").update(original).digest("hex"),
    sha256: createHash("sha256").update(data).digest("hex"),
    licenceCheckedOn: "2026-10-13", metadataRemoved: true,
    changes: "Auto-orientation; resized within 1600x1600 without enlargement; JPEG quality86 4:4:4; EXIF/IPTC/XMP removed. No generated object or brand added.",
    relationship: "Real third-party photograph used only as a representative educational category image; no business ownership, exact SKU match, partnership or endorsement claimed.",
  });
}

await writeFile(new URL("../../fixtures/business/assets/provenance.json", import.meta.url), `${JSON.stringify({ schemaVersion: 1, assets: evidence }, null, 2)}\n`);
console.log(`Pinned ${evidence.length} licensed photographs. Future fixture builds use these local files without network access.`);
