# Identity UI Integration

This feature contains real account forms for task 02.1.1, not the business shell.
Routes, root layout, server session lookup and metadata belong to MAIN.

## Root And Routes

Mount `IdentityLocaleProvider` once, in place of `LocaleProvider`, outside the
shared `ToastProvider`. Props are `initialLocale` and `children`. Read the account's
locale on the server where possible; an anonymous request uses the existing locale
cookie/default. Keep the provider and editable children unkeyed by language.

Import from `@/features/identity/ui`:

| Component | Route / Props |
| --- | --- |
| `IdentityEntryPage` | `/`, links to the available account routes, no future shell claims |
| `SignInPage`, `SignUpPage` | `/sign-in`, `/sign-up`; optional `returnTo`, `intentToken` |
| `VerifyEmailPage` | `/auth/verify`; optional opaque `token`, `returnTo`, `intentToken` |
| `ResetPasswordPage` | `/auth/reset`; optional opaque `token`, `returnTo`, `intentToken` |
| `SettingsPage` | `/settings`; optional safe `initialViewer` DTO, never auth tokens |
| `AccountMenu` | Existing signed-in navigation; optional `beforeSignOut`, `onSignedOut` |

Set document `referrer: "no-referrer"` on email-token routes. API request policy is
already no-referrer; it does not replace HTML document policy. Email verification
requires an explicit button press, never an effect/GET mutation. A missing reset
token displays the request form, not a broken password form. Email requests use
neutral responses and do not reveal whether an account exists.

`/app` is the authoritative default allowed return location. Until the real shell
is integrated, MAIN owns a redirect to an existing account route and preserves
only the opaque `intent` parameter. The UI reuses the domain return-path allowlist.

## Authentication And Drafts

`AuthDialog` accepts `open`, `onOpenChange`, `onAuthenticated(returnTo)`, optional
`returnFocus`, `returnTo`, and `intentToken`. Keep the caller's real draft outside
the dialog. Closing the dialog unmounts its credential form and aborts/invalidates
in-flight UI results. It does not cancel a server action already received.

The success callback reports authentication, not authorization to automatically
repeat a saved action. Never resubmit a generation, edit, order or export in that
callback. On expired authentication, the settings forms stay mounted for the
same user and require a new explicit submission. A different user ID replaces the
private settings tree and clears its old form values. Language changes do neither.

For a guest goal, first call `identityClient.saveIntent({ goal, returnTo }, key)`
with a fresh stable UUID idempotency key for that save attempt. Retain and pass the
returned opaque `intentToken`, not the goal/email/password in the URL. After sign-in
the owner may call `restoreIntent`, put the returned draft in its editor and let
the person review/submit. This module does not create a pretend editor or perform
the previous action automatically. Never store passwords or email/reset tokens in
local/session storage, a persisted query cache, telemetry or URLs.

## Account And Transport

`useIdentityAccount` exposes the safe viewer, readiness, `refresh`, `acceptUser`
and `clear`. The root provider checks the session on mount and visibility return.
Preference writes use the existing serialized locale store. Guest 401 removes
the account writer while the language cookie remains available. Logout invalidates
requests and the viewer. Old results cannot restore a previous account's state.

Transport validates authoritative input/output schemas, expects each operation's
own result status and displays only known localized error keys. It uses same-origin
JSON, no-store, no-referrer, a 20-second deadline and no automatic mutation retries.
`RequestOptions` accepts `signal` and `expectedUserId`; authenticated views send
`X-Tirlik-User-Id` so the server can reject a stale form if the session cookie now
belongs to another user. This header is a consistency guard, never authorization.

`SignOutDialog`/`AccountMenu.beforeSignOut` is an async boolean gate for future
editor owners to flush or protect pending work. Return false to keep the account
signed in. The default account UI warns about unsaved work, clears its own account
state after server acknowledgement (including an already-expired session), then
navigates to sign-in. Future module caches
must be cleared by their owner via `onSignedOut`; this feature cannot claim they
have been cleared before those modules exist.

## Verification Boundary

Tests exercise transport, validation, cancellation, duplicate/stale requests,
account changes, language persistence, error normalization, translations and email
formatting. TypeScript AST/CSS checks cover source contracts and client boundaries.
No test here renders a browser or proves appearance, focus behavior or keyboard
interaction. The user still checks desktop/mobile layout, 200% zoom, password
visibility/autofill, focus/error order, dialog return focus, language changes with
drafts, recovery links, sessions and Kazakh wording on integrated routes.

Team membership, invitations and ownership-safe deletion belong to checkpoint
02.1.2. They are not exposed as disabled placeholder controls in this checkpoint.
