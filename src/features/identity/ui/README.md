# Identity UI Integration

This feature contains real account, team and ownership-safe deletion flows for
tasks 02.1.1 and 02.1.2, not the business shell or final public landing page.
The public account routes mount these components directly. The root layout and
server session lookup provide the shared account context and route metadata.

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
| `ResetPasswordPage` | `/auth/reset`; optional opaque `token`, `returnTo`, `intentToken` |
| `SettingsPage` | `/settings`; optional safe `initialViewer` DTO, never auth tokens |
| `TeamSettingsPage` | `/settings/team`; optional `initialWorkspaceId`, a single validated UUID query value |
| `InvitePage` | `/settings/invitations/[token]`; opaque 64-character lowercase hex `token` |
| `AccountMenu` | Existing signed-in navigation; optional `beforeSignOut`, `onSignedOut` |

Set document `referrer: "no-referrer"` on the password-reset token route. API request
policy is already no-referrer; it does not replace HTML document policy. A missing
reset token displays the request form, not a broken password form. Email requests
use neutral responses and do not reveal whether an account exists.

Account, auth, team and route-state pages use `ProductHeader` with a compact,
labelled language selector. `IdentityFrame.headerActions` accepts optional trailing
account actions without importing account state into the shared header. The
account menu groups personal settings, team access and confirmed sign-out; opening
the menu does not start a mutation. Public sign-in/sign-up links remain available
in the entry HTML before the client account lookup finishes.

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
callback. Confirmed authentication loss unmounts the private settings/team tree
and cancels its operations. Only account-owned, nonpassword form input remains in
RAM outside that tree. The same user must explicitly continue after signing in;
fresh authorized data is loaded before team drafts reopen. Passwords, session lists
and destructive confirmations are not retained. A different user ID replaces the
owner and discards old drafts before private rendering. Language changes do neither.

For a guest goal, first call `identityClient.saveIntent({ goal, returnTo }, key)`
with a fresh stable UUID idempotency key for that save attempt. Retain and pass the
returned opaque `intentToken`, not the goal/email/password in the URL. After sign-in
the owner may call `restoreIntent`, put the returned draft in its editor and let
the person review/submit. This module does not create a pretend editor or perform
the previous action automatically. Never store passwords or email/reset tokens in
local/session storage, a persisted query cache, telemetry or URLs.

## Account And Transport

`useIdentityAccount` exposes the safe viewer, readiness, `refresh`, `acceptUser`
and `clear`. `authEpoch` is a nonsecret invalidation counter, incremented before
notifications on clear/account switch. `isCurrent(userId, authEpoch)` and
`invalidate(userId, authEpoch)` protect against old responses invalidating a new
session. Private recovery considers both user ID and epoch, including a batched
401 followed by same-user refresh. The root provider checks the session on mount and visibility return.
Preference writes use the existing serialized locale store. Guest 401 removes
the account writer while the language cookie remains available. Logout invalidates
requests and the viewer. Old results cannot restore a previous account's state.
`useIdentityGuard` rejects stale owners before and after an operation and turns a
direct current-session 401 into immediate account invalidation. Scoped team,
workspace, session, invitation and deletion-preview reads use that same boundary.

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

## Team And Deletion

The team route creates/selects actual workspaces and edits real memberships.
Reject malformed or duplicate `workspace` route query values instead of choosing
the first workspace. Guest and expired-session sign-in use an in-page AuthDialog;
the shared return allowlist preserves only a valid workspace UUID on the exact
team route. Do not key these forms by locale. A new account ID replaces the tree.

Render role, permission and per-record actions from the server's `allowedActions`.
The pure domain role presets initialize selections but do not grant authorization.
Team input and its payload-bound idempotency intent stay in the owner component's
RAM during same-user recovery; the server team snapshot does not. Destructive
target confirmations and permission review state reset on authentication loss.
Membership writes use the workspace security revision captured for review, not a
member's revision. A conflict requires an explicit refresh and another review;
403/404/409 reads clear inaccessible cached team details. All new writes include
an expected account ID and a payload-bound UUID idempotency key held only in RAM.
An identical retry reuses its key; a changed actor, target or payload does not.

Invitations have the fixed server TTL, explicit creation/resend/revocation, and
truthful sent/pending/sending/uncertain delivery states. Resending a still-valid
invitation preserves its link and expiry; an expired invitation is renewed.
Set no-referrer metadata on the invitation route. Invalid tokens render a generic
unavailable state before prompting sign-in; wrong-account/expired/revoked links
do not reveal the recipient or workspace. A GET only previews a matching verified
account's invitation. Joining always requires the explicit acceptance button.

Account deletion is the final section of SettingsPage. Its preview requires a
decision for every owned workspace: leave only when allowed, transfer to a
concrete eligible member, or delete with its exact name. The final step reviews
these decisions and requires the current password plus explicit consent. A stale
security revision blocks deletion until an explicit refresh and clears password/consent.
Successful acknowledgement clears account state and the entire private settings
tree, then shows the actual cleanup date. A timeout/network failure blocks another
submission until an explicit account-status check. The uncertain-attempt flag
survives private-tree unmount and dialog close; a missing session still shows a
generic uncertainty warning outside the private tree, never a success claim.
Copy distinguishes immediate loss of access, scheduled
cleanup and separately retained backups; it does not claim a production backup
exists or that every historical copy disappears immediately.

## Verification Boundary

Tests exercise transport, validation, cancellation, duplicate/stale requests,
account changes, language persistence, error normalization, translations and email
formatting. TypeScript AST/CSS checks cover source contracts and client boundaries.
No test here renders a browser or proves appearance, focus behavior or keyboard
interaction. The user still checks desktop/mobile layout, 200% zoom, password
visibility/autofill, focus/error order, dialog return focus, language changes with
drafts, recovery links, sessions, team selection/action dialogs, invitation
acceptance, deletion choices and Kazakh wording on integrated routes. Network
transport tests use fake fetch responses; real HTTP/database/mail coverage belongs
to the server and route integration checks. No visual finding is closed here.
