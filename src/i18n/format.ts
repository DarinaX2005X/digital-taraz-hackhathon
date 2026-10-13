import type { Money } from "@/contracts/primitives";
import { businessTimeZone, intlLocales, normalizeLocale, type Locale } from "./locales";

const languageTag = (locale: Locale) => intlLocales[normalizeLocale(locale)];

export function formatNumber(locale: Locale, value: number | bigint, options?: Intl.NumberFormatOptions): string {
  if (typeof value === "number" && !Number.isFinite(value)) throw new RangeError("Expected a finite number");
  return new Intl.NumberFormat(languageTag(locale), options).format(value);
}

function exactDecimal(locale: Locale, value: string, options: Intl.NumberFormatOptions = {}): string {
  if (value.length > 100 || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new TypeError("Expected a decimal string");
  }
  const [integer = "0", fraction = ""] = value.split(".");
  const integerValue = BigInt(integer);
  const signedValue = integerValue === 0n && value.startsWith("-") ? -0 : integerValue;
  const digitFormatter = new Intl.NumberFormat(languageTag(locale), { useGrouping: false });
  const fractionText = [...fraction].map((digit) => digitFormatter.format(Number(digit))).join("");
  const nonzeroFraction = integerValue === 0n && /[1-9]/.test(fraction);
  const signDisplay = nonzeroFraction && options.signDisplay === "exceptZero"
    ? "always"
    : options.signDisplay;
  // BigInt preserves the integer. Replace only the fraction, which Intl would otherwise round.
  return new Intl.NumberFormat(languageTag(locale), {
    ...options,
    signDisplay,
    minimumFractionDigits: fraction.length ? 1 : 0,
    maximumFractionDigits: fraction.length ? 1 : 0,
  }).formatToParts(signedValue).map((part) => part.type === "fraction" ? fractionText : part.value).join("");
}

export function formatDecimal(locale: Locale, value: string): string {
  return exactDecimal(locale, value);
}

export function formatMoney(locale: Locale, money: Money, options: Pick<Intl.NumberFormatOptions, "currencyDisplay" | "currencySign" | "signDisplay" | "useGrouping"> = {}): string {
  if (!/^[A-Z]{3}$/.test(money.currency) || !/^-?(?:0|[1-9]\d*)$/.test(money.minorUnits) || money.minorUnits.length > 80) {
    throw new TypeError("Expected ISO currency and integer minor units");
  }
  const currencyOptions = { ...options, style: "currency" as const, currency: money.currency };
  const digits = new Intl.NumberFormat(languageTag(locale), currencyOptions).resolvedOptions().maximumFractionDigits ?? 2;
  const negative = money.minorUnits.startsWith("-");
  const absolute = negative ? money.minorUnits.slice(1) : money.minorUnits;
  const padded = absolute.padStart(digits + 1, "0");
  const decimal = digits ? `${padded.slice(0, -digits)}.${padded.slice(-digits)}` : absolute;
  return exactDecimal(locale, `${negative ? "-" : ""}${decimal}`, currencyOptions);
}

export function formatUnit(locale: Locale, value: number | bigint, unit: string, options: Pick<Intl.NumberFormatOptions, "unitDisplay" | "maximumFractionDigits" | "minimumFractionDigits"> = {}): string {
  return formatNumber(locale, value, { ...options, style: "unit", unit });
}

export function formatInstant(locale: Locale, value: string | number | Date, options?: Intl.DateTimeFormatOptions): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.valueOf())) throw new RangeError("Invalid instant");
  return new Intl.DateTimeFormat(languageTag(locale), {
    ...(options ?? { dateStyle: "medium", timeStyle: "short" }), timeZone: options?.timeZone ?? businessTimeZone,
  }).format(instant);
}

export function formatCalendarDate(locale: Locale, value: string, options: Pick<Intl.DateTimeFormatOptions, "dateStyle" | "calendar"> = {}): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError("Expected a calendar date");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new RangeError("Invalid calendar date");
  return new Intl.DateTimeFormat(languageTag(locale), { dateStyle: "medium", ...options, timeZone: "UTC" }).format(date);
}

export function pluralCategory(locale: Locale, value: number, type: Intl.PluralRuleType = "cardinal"): Intl.LDMLPluralRule {
  if (!Number.isFinite(value)) throw new RangeError("Expected a finite count");
  return new Intl.PluralRules(languageTag(locale), { type }).select(value);
}

export function formatList(locale: Locale, values: readonly string[], options?: Intl.ListFormatOptions): string {
  return new Intl.ListFormat(languageTag(locale), options).format(values);
}
