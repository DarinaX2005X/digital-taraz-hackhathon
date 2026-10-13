# Locale Integration

The shared locales are `ru`, `kk` and `en`, matching `src/contracts/primitives.ts`.
`src/i18n/index.ts` is safe for server and client imports. Import client hooks
explicitly from `src/i18n/provider.tsx`; import request functions only from
`src/i18n/server.ts`.

## Root and Account

The root layout reads `await readRequestLocale()` and renders `<html lang={locale}>`
with `<LocaleProvider initialLocale={locale}>{children}</LocaleProvider>` inside
the body. Keep this provider above the editable route and do not give the provider,
editor, store, or children a locale-derived key. `initialLocale` is an initial
snapshot, not an instruction to replace current state after every server refresh.

`useLocale().setLocale(locale)` changes context immediately, writes a one-year,
same-site cookie, and updates the document language without router navigation.
The cookie contains a language code only. HTTPS adds `Secure`; it is readable by
the client intentionally. Blocked storage produces `cookie: "session-only"`.

Resolution order: validated public route locale, explicit cookie choice, account
preference, supported Accept-Language entry, then Russian. App editor URLs do not
contain a locale. A public localized route must supply its validated route locale
and update that URL when its language is changed. No automatic navigation occurs
inside the shared provider.

Account integration can pass a stable `persistPreference` callback. Writes are
serialized and intermediate selections coalesced. Failure keeps the selected
language and cookie, and produces `account: "failed"`. Account storage, permissions
and displaying that error belong to the account feature. When the authenticated
account changes, replace the callback; unauthenticated callers omit it.
`writeRequestLocale` is available for server actions and handlers only.

`LocaleSelect` from `@/ui` presents all three language choices and preference
pending/failure/session-only states. It calls the same stable store and does not
navigate. Mount `ToastProvider` under this locale provider; localized notification
text uses `(locale) => translator(locale)(key)` resolvers so an already-open notice
updates without replacing the editor. Plain notification strings are reserved for
user content that must not be translated automatically.

## Messages and Formats

Common messages use `getTranslations(locale)` or `useTranslations()`, with typed
keys such as `common.actions.save`. Feature-owned catalogs keep a distinct
namespace inside the feature. Type each translation with `MessageShape` of the
source catalog and pass all three locales to `createTranslator`.

Missing authored keys are programming errors, not permission to mix languages.
Parity tests require every common key to be a nonempty string in all locales.
Unknown API messages use a generic error in the chosen language through
`getErrorMessage`; raw server strings are never displayed by that helper.
Feature error messages are resolved by the owning feature before this fallback.

Use `formatMoney` for exact integer minor units and `formatDecimal` for exact
decimal strings. Neither passes monetary values through floating-point numbers.
Use `formatInstant` for instants in `Asia/Qyzylorda` unless an explicit zone is
provided. `formatCalendarDate` preserves the calendar day. Other helpers cover
numbers, Intl units, lists and plural categories. Business content is not translated.

The source checks do not prove mounted editor preservation, browser focus, layout,
touch behavior, or language quality. Those require the user's review on real routes.
