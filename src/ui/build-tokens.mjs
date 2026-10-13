import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function renderTokens(tokens) {
  const cssName = (value) => value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const lines = Object.entries(tokens).flatMap(([group, values]) =>
    Object.entries(values).map(([name, value]) => {
      const cssValue = value.replace(/\{([a-z]+)\.([a-zA-Z]+)\}/g,
        (_, referenceGroup, referenceName) => `var(--${referenceGroup}-${cssName(referenceName)})`);
      return `  --${group}-${cssName(name)}: ${cssValue};`;
    }),
  );
  return `/* Generated from tokens.json by node src/ui/build-tokens.mjs. */\n:root {\n${lines.join("\n")}\n}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tokens = JSON.parse(readFileSync(new URL("./tokens.json", import.meta.url), "utf8"));
  writeFileSync(new URL("./tokens.css", import.meta.url), renderTokens(tokens));
}
