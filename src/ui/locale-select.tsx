"use client";

import { isLocale, localeNames, locales } from "@/i18n";
import { useLocale, useTranslations } from "@/i18n/provider";
import { SelectField } from "./field";

export function LocaleSelect({ className }: { className?: string }) {
  const { locale, setLocale, cookie, account } = useLocale();
  const t = useTranslations();
  const error = account === "failed" ? t("common.locale.preferenceFailed") : undefined;
  const hint = cookie === "session-only" ? t("common.locale.sessionOnly") : undefined;
  return <div className={className}>
    <SelectField label={t("common.navigation.language")} value={locale} error={error} hint={hint} onChange={(event) => { if (isLocale(event.target.value)) setLocale(event.target.value); }}>
      {locales.map((language) => <option key={language} value={language} lang={language}>{localeNames[language]}</option>)}
    </SelectField>
    <span role="status" className="tirlik-sr-only">{account === "pending" ? t("common.locale.savingPreference") : account === "saved" ? t("common.locale.savedPreference") : ""}</span>
  </div>;
}
