import { describe, expect, it } from "vitest";
import { locales, messageKeys, type MessageTree } from "../../../src/i18n";
import { lookupMessage } from "../../../src/i18n/catalog";
import { formatIdentityMail, identityMessages, identityTranslator, type IdentityMessageKey } from "../../../src/features/identity/locales";

const placeholders = (text: string) => [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map((match) => match[1]).sort();

describe("identity catalog", () => {
  it("has the same complete namespace and variable sets for all three languages", () => {
    const source = identityMessages.ru;
    const keys = messageKeys(source);
    expect(keys.length).toBeGreaterThan(100);
    for (const locale of locales) {
      expect(messageKeys(identityMessages[locale])).toEqual(keys);
      for (const key of keys) {
        const translated = lookupMessage(identityMessages[locale] as MessageTree, key)!;
        expect(translated.trim()).not.toBe("");
        expect(placeholders(translated)).toEqual(placeholders(lookupMessage(source, key)!));
        expect(translated).not.toMatch(/TODO|FIXME|coming soon/);
      }
    }
  });

  it("formats known variables without interpreting user text as another template", () => {
    const t = identityTranslator("ru");
    expect(t("identity.signUp.passwordHint", { min: 12, max: 128 })).toBe("От 12 до 128 символов.");
    expect(t("identity.mail.invite.body", { workspaceName: "{url}" })).toContain("{url}");
    expect(() => t("identity.signUp.passwordHint")).toThrow("Missing identity message variable");
    expect(() => t("identity.missing" as IdentityMessageKey)).toThrow("Missing translation");
  });
});

describe("transactional mail", () => {
  it.each(locales)("formats actual verification/reset/invitation text in %s", (locale) => {
    for (const kind of ["verify", "reset", "invite"] as const) {
      const input = kind === "invite" ? { kind, workspaceName: "Example workspace", locale, url: "https://tirlik.example/auth/invite?token=opaque" } : { kind, locale, url: `https://tirlik.example/auth/${kind}?token=opaque` };
      const mail = formatIdentityMail(input);
      expect(mail.subject).toBe(identityTranslator(locale)(`identity.mail.${kind}.subject`));
      expect(mail.text).toContain(input.url);
      expect(mail.html).toContain(`<html lang="${locale}">`);
      expect(mail.html).toContain(identityTranslator(locale)(`identity.mail.${kind}.action`));
      expect(mail.text).not.toMatch(/\{workspaceName\}/);
      expect(mail.html).not.toContain("<script");
    }
  });

  it("escapes untrusted workspace text and URL query text in HTML without changing plain text", () => {
    const workspaceName = '<img src=x onerror="alert(1)"> & \'Team\'';
    const mail = formatIdentityMail({ kind: "invite", locale: "en", workspaceName, url: "https://tirlik.example/auth/invite?token=a&other=b" });
    expect(mail.text).toContain(workspaceName);
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
    expect(mail.html).toContain("&amp;other=b");
    expect(mail.subject).not.toContain(workspaceName);
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "https://user:password@evil.example/", "//evil.example/path", "https:\\evil.example", "https://example.test/\n"]) ("rejects unsafe mail URL %s", (url) => {
    expect(() => formatIdentityMail({ kind: "verify", locale: "ru", url })).toThrow();
  });

  it("supports the explicitly local Mailpit development URL but requires an invitation name", () => {
    expect(formatIdentityMail({ kind: "reset", locale: "kk", url: "http://127.0.0.1:59676/auth/reset?token=opaque" }).text).toContain("http://127.0.0.1:59676");
    expect(() => formatIdentityMail({ kind: "invite", locale: "ru", workspaceName: " ", url: "https://tirlik.example/" })).toThrow();
  });
});
