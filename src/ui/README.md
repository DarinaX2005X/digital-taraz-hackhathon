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

Interactive primitives are the next checkpoint. No component gallery or product
route is part of this foundation; MAIN integrates it with real routes. Visual
appearance and responsive behavior remain unverified by agents.
