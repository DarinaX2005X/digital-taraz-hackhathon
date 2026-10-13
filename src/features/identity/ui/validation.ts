import { EmailSchema, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../contracts";
import type { IdentityMessageKey } from "../locales";

export type FormErrors = Partial<Record<string, IdentityMessageKey>>;
export const passwordVariables = { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH };

export function validateEmail(value: string): IdentityMessageKey | undefined {
  return !value.trim() ? "identity.validation.required" : EmailSchema.safeParse(value.trim()).success ? undefined : "identity.validation.email";
}

export function validateName(value: string): IdentityMessageKey | undefined {
  return value.trim().length > 0 && value.trim().length <= 120 ? undefined : "identity.validation.name";
}

export function validatePassword(value: string, isNew: boolean): IdentityMessageKey | undefined {
  if (!value) return "identity.validation.required";
  if (!isNew && value.length > PASSWORD_MAX_LENGTH) return "identity.validation.currentPassword";
  return value.length < (isNew ? PASSWORD_MIN_LENGTH : 1) || value.length > PASSWORD_MAX_LENGTH ? "identity.validation.password" : undefined;
}

export function validateCredentials(mode: "sign-in" | "sign-up", values: { name: string; email: string; password: string; confirmation: string }): FormErrors {
  return {
    email: validateEmail(values.email), password: validatePassword(values.password, mode === "sign-up"),
    ...(mode === "sign-up" ? { name: validateName(values.name), confirmation: values.password !== values.confirmation ? "identity.validation.passwordMismatch" : validatePassword(values.confirmation, true) } : {}),
  };
}

export function hasErrors(errors: FormErrors): boolean { return Object.values(errors).some(Boolean); }

export function focusFirstError(form: HTMLFormElement | null, errors: FormErrors): void {
  if (!form) return;
  for (const control of form.elements) {
    if (control instanceof HTMLInputElement && errors[control.name]) { control.focus(); return; }
  }
}
