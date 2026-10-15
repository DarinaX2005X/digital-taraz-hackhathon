"use client";

import { isLocale, localeNames, locales, type Locale } from "@/i18n";
import { Languages, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "@/i18n/provider";
import { SelectField } from "./field";
import { Button } from "./button";

export function LocaleSelect({ className = "", compact = false, selectedLocale, onLocaleChange }: { className?: string; compact?: boolean; selectedLocale?: Locale; onLocaleChange?: (locale: Locale) => void }) {
  const { locale, setLocale, cookie, account } = useLocale();
  const t = useTranslations();
  const error = account === "failed" ? t("common.locale.preferenceFailed") : undefined;
  const hint = cookie === "session-only" ? t("common.locale.sessionOnly") : undefined;
  return <div className={`tl-locale ${compact ? "tl-locale--compact" : ""} ${className}`}>
    {compact && <Languages aria-hidden="true" size={18} className="tl-locale__icon" />}
    <SelectField label={t("common.navigation.language")} value={selectedLocale ?? locale} error={error} hint={hint} onChange={(event) => { if (isLocale(event.target.value)) { setLocale(event.target.value); onLocaleChange?.(event.target.value); } }}>
      {locales.map((language) => <option key={language} value={language} lang={language}>{localeNames[language]}</option>)}
    </SelectField>
    {account === "failed" && <Button variant="quiet" icon={RefreshCw} onClick={() => setLocale(locale)}>{t("common.actions.retry")}</Button>}
    <span role="status" className="tirlik-sr-only">{account === "pending" ? t("common.locale.savingPreference") : account === "saved" ? t("common.locale.savedPreference") : ""}</span>
  </div>;
}
