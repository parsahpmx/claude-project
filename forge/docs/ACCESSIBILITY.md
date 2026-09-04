# Accessibility

What FORGE guarantees, and how each guarantee is checked rather than asserted.

## Guaranteed

**Contrast.** Body text meets WCAG AA against every surface it is used on. The
single accent (`#E8462B`) is never used for small text on the light ground —
it appears as a fill behind light text, as a border, or at 600 weight on
headings. Secondary text uses `smoke-500` on bone and `bone-200/60` on ink,
both of which clear 4.5:1.

**Focus.** One focus ring, one shape, everywhere: a 2px accent ring with a 2px
offset, defined once in `globals.css` on `:focus-visible`. On dark surfaces the
offset colour swaps automatically via the `.dark-surface` class. A keyboard
user never has to guess where they are.

**Touch targets.** Every interactive element is at least 40px tall; primary
actions are 48–56px. The button size scale has no option below 40px.

**Never colour alone.** Every status carries a glyph *and* a word alongside its
colour — `✓ Completed`, `× Missed`, `○ Scheduled`, `↻ Syncing`. The heatmap
ramp varies lightness as well as hue so it survives greyscale. Charts label
their first, last and peak values as text, and carry an `aria-label` describing
the series in words.

**Real labels.** Every form control renders a `<label>` bound by `id`. A
placeholder is never a substitute for one — it disappears the moment somebody
types, which is exactly when a distracted or screen-reader user needs it. The
large visual choice cards in onboarding are real `<input type="radio">` and
`<input type="checkbox">` elements behind the card, so keyboard navigation,
form semantics and grouping all work without reimplementation.

**Motion.** Every animation in FORGE is decoration, and every one is disabled
under `prefers-reduced-motion: reduce`. The animated counter renders its final
value immediately rather than not at all.

**No horizontal scrolling.** Wide content — tables, timelines, heatmaps,
calendars — scrolls inside its own container. The page body never does.

**Skip link.** The first focusable element on the marketing site jumps to
`#main`.

**Captions.** Every recovery session and coached workout is marked with whether
captions are available, on the card rather than buried in a player.

## How it is checked

Not by assertion. A Chromium harness loads all 33 screens at 390px and 1280px,
signed out, as a member and as a coach, and fails on:

- any console error or React hydration mismatch;
- any page where `window.scrollX` is non-zero after scrolling right, which is
  the ground truth for horizontal overflow rather than a layout-rect
  approximation that counts clipped content as overflow;
- any HTTP status other than 200 on a route the product links to.

That sweep found and fixed four real defects: two broken links to pages that
were never built, a hydration mismatch caused by `Intl` disagreeing between
Node and Chromium about the `en-GB` abbreviation for September, and a mobile
layout where a grid child's default `min-width: auto` let a horizontal timeline
push the whole document sideways.

## Not yet done

- No automated axe/WCAG rule sweep in CI. The checks above are behavioural, not
  a full audit.
- No screen-reader testing with an actual screen reader.
- The generated imagery carries descriptive `aria-label`s derived from its key,
  which is honest but thinner than a human-written alt text would be.
- Colour contrast is designed to AA and spot-checked, not machine-verified on
  every token pair.
