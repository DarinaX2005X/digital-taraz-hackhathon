# Shared UI Foundation

Import `src/ui/foundation.css` once in the root layout. Import `tirlikFont` from
`src/ui/font.ts` and apply `tirlikFont.variable` to the root HTML element.
Next serves the four local Noto Sans fonts without an external font service.

`tokens.json` is the canonical raw and semantic token source. Run
`node src/ui/build-tokens.mjs` after changing it. The parity test compares generated
`tokens.css` against that source. Consumers use semantic CSS variables such as
`--color-action`, `--space-4`, `--radius-control`, and `--size-touch`.
File exporters can use `colorValue("action")` and `designTokens` from `tokens.ts`.

The fonts and their OFL are in `public/fonts/noto-sans/`. Its manifest records the
official pinned revision, hashes and unmodified static files. Those same TTF files
can be embedded in documents. The font test reads each binary's cmap, OS/2 weight
and embedding permissions. It does not inspect text rendering.

Brand assets are `/brand/tirlik-mark.svg`, `/brand/tirlik-mark-mono.svg`, and
`/brand/favicon.svg`. The approved original geometry is preserved, including its
background. Root metadata can set `icons.icon` to the SVG favicon. Color roles
are tested for text and control contrast; coral is an art accent, not body text
or an error state. Divider color is not sufficient for a required control boundary.

Base CSS provides type roles, input inheritance, 44px control minimums, visible
focus, reduced-motion tokens, forced-color focus and tabular numeric text. A plain
text link still needs a sufficient target in its component context. Required
labels and actions must wrap; tables and canvases own their overflow. Components
must use the motion tokens so reduced-motion preferences take effect.

## Controls

Import the shared controls from `@/ui`. Ariakit supplies dialog, combobox, tabs,
toolbar and tooltip semantics; React 19 refs are forwarded to the actual control.
This is a foundation for real product routes, not a separate component gallery.

| Export | Contract |
| --- | --- |
| `Button`, `IconButton` | Explicit commands, Lucide icons, 44px targets, pending/disabled states. `Button.pendingLabel` reserves both labels' geometry and exposes only the current label. Without it, the existing children remain visible while pending. Icon buttons require a localized `label` independent of their tooltip. `disabledReason` remains accessible while disabled. Default `type` is `button`; form submission needs `type="submit"`. |
| `InputField`, `TextareaField`, `SelectField`, `CheckboxField` | Native input props, ref and controlled/uncontrolled values. Required `label`, optional `hint` and field `error`; input may show `unit`. Descriptions/errors are associated by ID; errors do not clear the value. `className` styles the field wrapper. |
| `Combobox` | Controlled `SelectOption \| null`; options have stable IDs, labels, optional descriptions and disabled state. Supply either `options` or `loadOptions`, not both. Only a current, enabled list option can be selected. |
| `Dialog`, `DialogClose` | Controlled modal, optional `placement="side"` drawer, title/description, scrollable body/footer, initial and return focus refs. Dirty drafts require explicit discard confirmation. |
| `Tabs` | Controlled stable item ID, localized label/content, optional disabled item. `appearance="segmented"` is for view modes. Hidden panels remain mounted. The owner supplies unique IDs and an existing enabled `value`. |
| `TableFrame` | Named, keyboard-focusable scrolling region. Supply a native table with its own caption and headers; default minimum table width is 640px. Does not add grid editing, sorting or virtualization. |
| `Toolbar`, `ToolbarItem` | Named toolbar and composite items for keyboard navigation. Icon targets keep 44x44 geometry and the toolbar owns narrow-width overflow. |
| `SaveStatus` | `saving`, `saved`, `unsaved`, `local`, `offline` or `conflict`, optional detail and retry. This presents an actual persistence state; it does not save data or infer success. |
| `EmptyState`, `ErrorState`, `LoadingState`, `Skeleton` | Object-specific copy/actions and retained children, polite loading, assertive error. Skeleton dimensions are explicit and static; do not replace existing work with a blank loading surface. |
| `ToastProvider`, `useToast` | Deduplicated notification IDs, update/dismiss/clear, persistent errors/actions, timed information with hover/focus pause. |
| `LocaleSelect` | All three language names, existing cookie/account preference states, no editor navigation or remount. Optional `compact` hides the associated label visually for headers and adds a language icon; errors and retry remain available. |
| `ProductHeader` | Shared branded full-width header, named home link and trailing action slot. Required localized `homeLabel`; optional `homeHref` defaults to `/`. No account state or feature navigation is created here. |

### Search

Use stable `options` arrays or `loadOptions` callbacks. A changed loader reruns an
active query. Search waits 250ms after typing; opening and retry are immediate.
The loader receives an `AbortSignal`. Forward it to fetch and scope/authorize the
request in the feature. Superseded and cancelled results cannot replace current
options even when a loader ignores abort. Failed and pending searches retain the
old data but disable selection until the current result is ready. Duplicate IDs or
empty labels are reported as a load failure.

`name` produces a hidden field containing only the selected ID. Arbitrary text
has no selected value and fails native form validation, including when the field
is optional but contains unmatched text. Clearing an optional field is valid.
Validate the ID and access again on the server. Native form validation requires a
real form submission or `reportValidity()`; a custom callback cannot assume it ran.
The list distinguishes no available options, no matches, and load failure with
retry. The controller does not translate user-authored option labels.

### Draft Protection

```tsx
<Dialog
  open={open}
  onOpenChange={setOpen}
  title={t("profile.title")}
  dirty={draftChanged}
  onDiscard={resetDraft}
  initialFocus={nameInput}
  returnFocus={editButton}
  footer={<DialogClose>{t("common.actions.cancel")}</DialogClose>}
>
  <InputField ref={nameInput} label={t("profile.name")} value={name} onChange={changeName} />
</Dialog>
```

Close icon, Escape, outside interaction and `DialogClose` enter the same guard.
The nested confirmation keeps the editor mounted and focuses keep-editing first.
Cancelling the warning returns to the unchanged editor; discard calls `onDiscard`
before asking the owner to close. That callback must actually reset the draft.
Passing `open={false}` directly or unmounting the component bypasses the guard:
reserve direct closure for a confirmed save/discard, not footer cancellation.
Route changes, browser Back and tab closing require feature-level dirty navigation
protection; this primitive does not intercept the whole application's history.

### Feedback and Language

Mount one `ToastProvider` under `LocaleProvider` and above editable routes. `notify`
returns an ID; a supplied ID replaces an existing notice in place. Errors and
notices with an action never auto-dismiss; other notices default to 8 seconds with
a 6-second minimum, or persist with `durationMs: null`. An action does not dismiss
itself: the consumer dismisses it after actual recovery, retaining failed work.
Critical errors must also be shown at their field/object, not only in a toast.

System copy uses locale resolvers so existing notifications follow a language
change. Plain strings are for user-authored content, which must not be translated.

```tsx
notify({
  id: "profile-saved",
  tone: "success",
  title: (locale) => getTranslations(locale)("common.state.saved"),
});

<Toolbar label={t("document.tools")}>
  <ToolbarItem render={<IconButton icon={Undo2} label={t("common.actions.undo")} />} />
</Toolbar>
```

Feature catalogs supply their own namespace; the snippets' feature keys are
examples, not new shared keys. Keep locale out of editor/provider/record keys.
Preserve controlled record IDs across translated labels. Do not put the local
font build import in a client barrel; use `@/ui/font` from the server layout only.

## Verification Boundary

Unit tests cover debounce, abort, stale-response rejection, retry, invalid option
data, locale/source refresh, dialog close state, notification identity and text
resolution. Type checking and source contracts cover label associations,
client/server boundaries, retained panels, refs, fixed dimensions, overflow and
reduced-motion rules. These checks do not execute a browser or render a UI.

On integrated routes, the user still verifies keyboard order, tooltip/focus
behavior, Escape/keep/discard and return focus, async search/clear/retry, language
switch with an unsaved draft, toast pause/dismiss, 200% zoom, reduced motion and
360/390/768/1280/1440/1920px layouts. In particular, check drawer keyboard/safe-area
behavior and table-owned scrolling. Kazakh copy requires the user's reading.
No visual appearance or browser interaction is claimed as verified.
