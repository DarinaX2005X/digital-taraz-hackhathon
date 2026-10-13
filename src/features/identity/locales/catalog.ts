import { createTranslator, type Locale, type MessageKey, type MessageShape } from "@/i18n";
import { en } from "./en";
import { kk } from "./kk";
import { ru } from "./ru";

export const identityMessages = { ru, kk, en } satisfies Record<Locale, MessageShape<typeof ru>>;
export type IdentityMessageKey = MessageKey<typeof ru>;
export type IdentityVariables = Readonly<Record<string, string | number>>;

export function identityTranslator(locale: Locale) {
  const translate = createTranslator(locale, identityMessages as Record<Locale, MessageShape<typeof ru>>);
  return (key: IdentityMessageKey, variables: IdentityVariables = {}): string => translate(key).replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_match, name: string) => {
    if (!Object.hasOwn(variables, name)) throw new Error(`Missing identity message variable: ${key}/${name}`);
    return String(variables[name]);
  });
}
