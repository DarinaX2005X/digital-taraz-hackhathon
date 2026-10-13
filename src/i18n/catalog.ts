import type { ErrorCode } from "@/contracts/errors";
import { normalizeLocale, type Locale } from "./locales";
import { en } from "./messages/en";
import { kk } from "./messages/kk";
import { ru } from "./messages/ru";
import type { MessageKey, MessageShape, MessageTree } from "./messages/types";

export type { MessageKey, MessageShape, MessageTree } from "./messages/types";
export type CommonMessageKey = MessageKey<typeof ru>;
export const messages = { ru, kk, en } satisfies Record<Locale, MessageShape<typeof ru>>;

export function messageKeys(tree: MessageTree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : messageKeys(value, path);
  }).sort();
}

export function lookupMessage(tree: MessageTree, key: string): string | undefined {
  let result: string | MessageTree = tree;
  for (const segment of key.split(".")) {
    if (typeof result === "string" || !Object.hasOwn(result, segment)) return undefined;
    const next: string | MessageTree | undefined = result[segment];
    if (next === undefined) return undefined;
    result = next;
  }
  return typeof result === "string" ? result : undefined;
}

// Feature modules keep their own namespace and use this same complete-locale contract.
export function createTranslator<T extends MessageTree>(locale: Locale, catalog: Record<Locale, T>) {
  return (key: MessageKey<T>): string => {
    const value = lookupMessage(catalog[normalizeLocale(locale)], key);
    if (value === undefined) throw new Error(`Missing translation: ${locale}/${key}`);
    return value;
  };
}

export function getTranslations(locale: Locale) {
  return createTranslator(locale, messages as Record<Locale, MessageShape<typeof ru>>);
}

const errorKeys = {
  UNAUTHENTICATED: "common.errors.unauthenticated",
  FORBIDDEN: "common.errors.forbidden",
  NOT_FOUND: "common.errors.notFound",
  CONFLICT: "common.errors.conflict",
  PAYLOAD_TOO_LARGE: "common.errors.payloadTooLarge",
  VALIDATION_FAILED: "common.errors.validationFailed",
  RATE_LIMITED: "common.errors.rateLimited",
  PROVIDER_FAILED: "common.errors.providerFailed",
  UNAVAILABLE: "common.errors.unavailable",
  INTERNAL_ERROR: "common.errors.unexpected",
} as const satisfies Record<ErrorCode, CommonMessageKey>;

export function getErrorMessage(locale: Locale, error: { code?: unknown; messageKey?: unknown }): string {
  const dictionary = messages[normalizeLocale(locale)];
  if (typeof error.messageKey === "string" && error.messageKey.startsWith("common.errors.")) {
    const message = lookupMessage(dictionary, error.messageKey);
    if (message) return message;
  }
  const key = typeof error.code === "string" && Object.hasOwn(errorKeys, error.code)
    ? errorKeys[error.code as ErrorCode] : "common.errors.unexpected";
  return getTranslations(locale)(key);
}
