import { describe, expect, it } from "vitest";
import { authHref } from "@/features/identity/ui/navigation";
import { hasErrors, passwordVariables, validateCredentials, validateEmail, validateName, validatePassword } from "@/features/identity/ui/validation";
import { identityTranslator } from "@/features/identity/locales";

describe("account form validation", () => {
  it("checks required fields, names, Unicode names and trimmed email input", () => {
    expect(validateName("  ")).toBe("identity.validation.name");
    expect(validateName("Әлия" )).toBeUndefined();
    expect(validateName("a".repeat(121))).toBe("identity.validation.name");
    expect(validateEmail("")).toBe("identity.validation.required");
    expect(validateEmail("bad@")).toBe("identity.validation.email");
    expect(validateEmail(" Name@example.test ")).toBeUndefined();
  });

  it("accepts existing shorter passwords for sign-in but requires the current rule for a new password", () => {
    expect(validatePassword("short", false)).toBeUndefined();
    expect(validatePassword("short", true)).toBe("identity.validation.password");
    expect(validatePassword("x".repeat(12), true)).toBeUndefined();
    expect(validatePassword("x".repeat(128), true)).toBeUndefined();
    expect(validatePassword("x".repeat(129), true)).toBe("identity.validation.password");
    expect(validatePassword("x".repeat(129), false)).toBe("identity.validation.currentPassword");
    for (const locale of ["ru", "kk", "en"] as const) expect(identityTranslator(locale)(validatePassword("x".repeat(129), false)!, passwordVariables)).toContain("128");
  });

  it("does not require sign-up-only fields for sign-in", () => {
    expect(hasErrors(validateCredentials("sign-in", { name: "", email: "a@example.test", password: "short", confirmation: "" }))).toBe(false);
    expect(hasErrors(validateCredentials("sign-up", { name: "", email: "a@example.test", password: "short", confirmation: "" }))).toBe(true);
  });

  it("reports confirmation mismatch without altering either password", () => {
    const values = { name: "Person", email: "a@example.test", password: "password with spaces ", confirmation: "password with spaces" };
    expect(validateCredentials("sign-up", values).confirmation).toBe("identity.validation.passwordMismatch");
    expect(values.password.endsWith(" ")).toBe(true);
  });
});

describe("auth navigation state", () => {
  it("keeps only an allowed return location and opaque intent", () => {
    const opaque = "a".repeat(64);
    const href = authHref("/sign-in", { returnTo: "/settings?password=private#section", intentToken: opaque });
    const parsed = new URL(href, "https://tirlik.invalid");
    expect(parsed.searchParams.get("returnTo")).toBe("/settings");
    expect(parsed.searchParams.get("intentToken")).toBe(opaque);
    expect(href).not.toContain("password");
  });

  it("uses the shared server redirect allowlist and rejects arbitrary navigation state", () => {
    expect(authHref("/sign-up", { returnTo: "https://attacker.test", intentToken: "freeform-goal" })).toBe("/sign-up?returnTo=%2Fapp");
    expect(authHref("/auth/reset")).toBe("/auth/reset");
  });

  it("preserves a specific team destination through authentication without carrying private query values", () => {
    const workspaceId = "d57f5c5b-591e-4fbb-be11-4b9671b33b88";
    const href = authHref("/sign-in", { returnTo: `/settings/team?workspace=${workspaceId}&email=private@example.test`, intentToken: "a".repeat(64) });
    const query = new URL(href, "https://tirlik.invalid").searchParams;
    expect(query.get("returnTo")).toBe(`/settings/team?workspace=${workspaceId}`);
    expect(query.get("intentToken")).toBe("a".repeat(64));
    expect(href).not.toContain("private");
    expect(new URL(authHref("/sign-in", { returnTo: `/settings/team?workspace=${workspaceId}&workspace=${workspaceId}` }), "https://tirlik.invalid").searchParams.get("returnTo")).toBe("/app");
  });
});
