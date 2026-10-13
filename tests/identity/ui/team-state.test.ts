import { describe, expect, it } from "vitest";
import { scopesForRole } from "@/features/identity/domain/policy";
import { defaultGrant, grantForRole, roleLabels, scopeChanges, scopeLabels, validGrant, type GrantOptions } from "@/features/identity/ui/team-state";
import { identityTranslator } from "@/features/identity/locales";
import { AccessScopeSchema, MembershipRoleSchema } from "@/features/identity/contracts";

const all: GrantOptions = { roles: ["owner", "editor", "reviewer"], scopes: scopesForRole("owner") };

describe("server-authorized grant selection", () => {
  it("uses the authoritative domain presets and the available action inventory", () => {
    expect(defaultGrant(all)).toEqual({ role: "editor", scopes: scopesForRole("editor") });
    expect(defaultGrant({ roles: ["reviewer"], scopes: ["read", "approve"] })).toEqual({ role: "reviewer", scopes: ["read", "approve"] });
    expect(defaultGrant({ roles: [], scopes: [] })).toBeUndefined();
  });
  it("never expands a preset beyond the actor's current grantable scopes", () => {
    expect(grantForRole("editor", { roles: ["editor"], scopes: ["read"] })).toEqual({ role: "editor", scopes: ["read"] });
    expect(validGrant({ role: "editor", scopes: ["read", "edit"] }, { roles: ["editor"], scopes: ["read"] })).toBe(false);
  });
  it("rejects removed roles, missing read, duplicate scopes and incomplete ownership", () => {
    expect(validGrant({ role: "owner", scopes: scopesForRole("owner") }, all)).toBe(true);
    expect(validGrant({ role: "owner", scopes: ["read", "edit"] }, all)).toBe(false);
    expect(validGrant({ role: "editor", scopes: ["edit"] }, all)).toBe(false);
    expect(validGrant({ role: "editor", scopes: ["read", "read"] }, all)).toBe(false);
    expect(validGrant({ role: "editor", scopes: ["read"] }, { roles: ["reviewer"], scopes: ["read"] })).toBe(false);
  });
  it("supports explicitly authorized custom scopes for nonowners", () => {
    expect(validGrant({ role: "reviewer", scopes: ["read", "read-confidential"] }, all)).toBe(true);
  });
  it("describes actual permission changes without treating a reorder as a change", () => {
    expect(scopeChanges(["read", "edit"], ["read", "approve"])).toEqual({ added: ["approve"], removed: ["edit"] });
    expect(scopeChanges(["read", "edit"], ["edit", "read"])).toEqual({ added: [], removed: [] });
  });
  it("has localized display labels for every contract role and permission", () => {
    expect(Object.keys(scopeLabels)).toEqual(AccessScopeSchema.options);
    expect(Object.keys(roleLabels)).toEqual(MembershipRoleSchema.options);
    for (const locale of ["ru", "kk", "en"] as const) {
      const t = identityTranslator(locale);
      for (const key of [...Object.values(scopeLabels), ...Object.values(roleLabels)]) expect(t(key)).not.toBe(key);
    }
  });
});
