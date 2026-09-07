# Accessibility

What FORGE guarantees, and how each guarantee is checked rather than asserted.

## Guaranteed

**Contrast.** Every text node on all 43 routes clears WCAG AA, verified with
axe-core in a real browser at 390px and 1280px, signed out, as a member and as
a coach. That is a measured claim, not a design intention: an earlier version of
this document asserted AA compliance and the first machine pass found 166
failing nodes behind the assertion.

Three rules came out of that pass and now hold across the system:

1. **Secondary text is a colour, not a transparency.** `opacity-50` on body copy
   looks like hierarchy and measures like a defect — dimming text that is
   already muted compounds, and the worst case here landed at 1.72:1. The
   `.text-muted` class carries a real token instead.
2. **The accent has three steps, and only one goes under small text.**
   `ember-500` is the brand red and stays the graphic colour, where the bar is
   3:1. It reaches only 3.76:1 against bone, so text and text-bearing surfaces
   take `ember-600`, and text on an accent-tinted ground takes `ember-700` —
   a tint of the same hue costs about a quarter point of contrast.
3. **Status colours are for marks, not words.** The bright signal hues label
   dots, bars, borders and chart strokes. Under a 10px badge label on a tint of
   their own hue they measure between 2.2:1 and 4.1:1, so text takes a darkened
   step on bone and a lightened one on ink.

**Surfaces carry their own palette.** FORGE puts light cards inside dark
sections and dark cards inside light ones, so "muted" has no single value. Each
of these classes reads a CSS custom property that `.light-surface` and
`.dark-surface` re-point for their subtree. Custom properties inherit from the
nearest ancestor that sets one, which is exactly the needed rule and is
something descendant selectors cannot express: `.dark-surface .text-muted` and
`.light-surface .text-muted` have equal specificity, so source order would
decide globally and one of the two nestings would always be wrong.

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
- Contrast is machine-verified on every rendered text node across all 43 routes
  at 390px and 1280px, in all three signed-in states. It is not verified for
  colour combinations that only appear in states the crawl does not reach —
  for example a form field mid-validation on a route it did not submit.
