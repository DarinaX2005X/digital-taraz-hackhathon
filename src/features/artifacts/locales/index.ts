import { createTranslator, type Locale, type MessageKey, type MessageShape } from "@/i18n";
import { ru } from "./ru";
import { en } from "./en";
import { kk } from "./kk";
export const artifactMessages = { ru, kk, en } satisfies Record<Locale, MessageShape<typeof ru>>;
export type ArtifactMessageKey = MessageKey<typeof ru>;
export function artifactTranslator(locale: Locale) {
  const translate = createTranslator(locale, artifactMessages as Record<Locale, MessageShape<typeof ru>>);
  return (key: ArtifactMessageKey, variables: Readonly<Record<string, string | number>> = {}): string => translate(key).replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_match, name: string) => {
    if (!Object.hasOwn(variables, name)) throw new Error(`Missing artifact message variable: ${key}/${name}`);
    return String(variables[name]);
  });
}
export type ArtifactTranslator = ReturnType<typeof artifactTranslator>;
