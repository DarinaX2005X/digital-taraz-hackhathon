"use client";

import { useState, type ReactNode } from "react";
import { CheckboxField, SelectField } from "@/ui";
import type { AccessScope, MembershipRole } from "../contracts";
import { useIdentityTranslations } from "./hooks";
import { createIdentityWriteIntent } from "./write-intent";
import { grantForRole, roleLabels, scopeLabels, type Grant, type GrantOptions } from "./team-state";
import styles from "./identity.module.css";

export type IdentityAuthGuard = <T>(signal: AbortSignal, action: () => Promise<T>) => Promise<T>;
export function useIdentityWriteIntent() {
  const [intent] = useState(createIdentityWriteIntent);
  return intent;
}
export function ScopeList({ scopes }: { scopes: readonly AccessScope[] }) {
  const t = useIdentityTranslations();
  return <ul className={styles.scopeList}>{scopes.map((scope) => <li key={scope}>{t(scopeLabels[scope])}</li>)}</ul>;
}
export function GrantFields({ value, onChange, options, disabled, error }: { value: Grant; onChange: (value: Grant) => void; options: GrantOptions; disabled?: boolean; error?: string }) {
  const t = useIdentityTranslations();
  return <div className={styles.stack}>
    <SelectField label={t("identity.access.role")} name="role" value={value.role} disabled={disabled} error={error} onChange={(event) => onChange(grantForRole(event.target.value as MembershipRole, options))}>
      {!options.roles.includes(value.role) && <option value={value.role} disabled>{t(roleLabels[value.role])}</option>}
      {options.roles.map((role) => <option key={role} value={role}>{t(roleLabels[role])}</option>)}
    </SelectField>
    <fieldset className={styles.scopeFields} disabled={disabled}><legend>{t("identity.access.permissions")}</legend>
      {options.scopes.map((scope) => <CheckboxField key={scope} label={t(scopeLabels[scope])} checked={value.scopes.includes(scope)} disabled={scope === "read" || value.role === "owner"} onChange={(event) => onChange({ ...value, scopes: event.target.checked ? [...value.scopes, scope] : value.scopes.filter((item) => item !== scope) })} />)}
    </fieldset>
  </div>;
}
export function PersonIdentity({ name, email, children }: { name?: string; email: string; children?: ReactNode }) {
  return <div className={styles.person}><strong>{name ?? email}</strong>{name && <span>{email}</span>}{children}</div>;
}
