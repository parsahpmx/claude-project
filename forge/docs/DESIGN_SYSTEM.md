# Design system

Live at [`/design-system`](http://localhost:3000/design-system) — every token,
component and state rendered from the same code the product uses.

## On the Stitch designs

The brief supplied a Stitch project (`11871348676057012025`) with eight screens.
`stitch.withgoogle.com` is blocked by this environment's egress proxy, so those
screens could not be fetched and are not the source of this visual identity.

What is here was built from the **written brand direction in the brief** —
editorial luxury, near-black and warm off-white, one accent, oversized display
headlines, sharp cards, restrained shadows. If the Stitch screens are supplied
later, the token file and the component variants are the only two places that
need to change; no page reaches for a raw colour or a raw font size.

## Tokens

**Colour.** Deliberately narrow: an editorial near-black, a warm off-white,
four greys and exactly one accent. A single accent is what makes "this is the
thing to press" legible on every screen without a legend, and it is why the
product does not look like a dashboard template.

| Token | Value | Used for |
| --- | --- | --- |
| `ink-900` | `#0B0B0C` | Primary dark surface, page ground in dark mode |
| `ink-800` | `#121214` | Raised dark surface |
| `bone-100` | `#FBFAF8` | Card surface |
| `bone-200` | `#F5F2ED` | Page ground |
| `bone-300` | `#E7E2DA` | Section tint |
| `smoke-500` | `#5C5C64` | Secondary text on bone |
| `smoke-400` | `#9C9CA4` | Secondary text on ink |
| `ember-500` | `#E8462B` | The accent, as a graphic: chart strokes, rules, marks |
| `ember-600` | `#C4351E` | The accent under or behind small text |
| `ember-700` | `#A32A15` | The accent on a ground tinted with its own hue |
| `signal-*` | good/warn/bad/info | Status marks — never the only carrier of meaning |
| `signal-*-ink` | darkened | Status **text** on bone |
| `signal-*-on-ink` | lightened | Status **text** on ink |

The accent has three steps because contrast, not taste, splits it: `ember-500`
is the brand red and clears the 3:1 a graphic owes, but only 3.76:1 against
bone, which fails under an 11px label. Each step up buys back the difference,
and `ember-700` covers the case where the ground is tinted with the same hue.
The same logic gives status colours a bone-ground and an ink-ground text
variant. See ACCESSIBILITY.md for the measurements.

**Secondary text is a colour, never an opacity.** `opacity-50` on body copy
reads as hierarchy and measures as a failure — worse when it stacks on text
that is already muted, which bottomed out at 1.72:1 here. Use `.text-muted`.

**Surfaces declare themselves.** Any element that sets a solid ground carries
`light-surface` or `dark-surface`. Those classes re-point the CSS custom
properties behind `.text-muted`, `.eyebrow`, `.text-accent`, the status classes,
`.rule` and `.hairline`, so a light card inside a dark section — which this
product does — gets bone-ground values for its own subtree. Custom properties
inherit from the nearest ancestor that sets them; descendant selectors cannot
express "nearest wins" at equal specificity. `accent-tint` marks a panel tinted
with the accent hue and shifts accent text one step deeper.

**Type.** A display face for headlines and a modern sans for everything else.
Sizes are `clamp()`-based so a headline scales from 390px to 1440px without a
breakpoint. The floors are set low enough that a long unbreakable word
(`ACCOUNTABILITY.`) fits a 390px viewport, and `.display` carries
`overflow-wrap: break-word` as a second line of defence.

Web fonts cannot be loaded in this environment (egress is blocked), so the
display face falls back Archivo Black → Arial Black → Helvetica Neue, and body
text falls back to the system UI stack. The stacks are declared as CSS
variables, so adding the real faces is a one-line change.

**Elevation.** Two shadows, both low-contrast. Elevation is communicated by
border and background before it is communicated by shadow — that is what keeps
a screen with fourteen cards on it from looking like a pile of receipts.

## Components

Every component is a **closed set of variants** rather than a `className`
passthrough with defaults. Forty screens built from open-ended components drift
within a week; a closed variant list is what keeps the eleventh screen looking
like the first.

- **Primitives** — `Button`, `ButtonLink`, `Chip`, `Card`, `CardLink`, `Media`,
  `Section`, `SectionHeading`, `Stat`, `Divider`
- **Forms** — `TextInput`, `TextArea`, `Select`, `ChoiceCard`, `Toggle`,
  `Checkbox`, `FilterChips`, `SearchInput`, `Tabs`, `Counter`
- **Feedback** — `EmptyState`, `ErrorState`, `SuccessState`, `Skeleton`,
  `SkeletonCard`, `Status`, `Badge`
- **Charts** — `ProgressRing`, `ProgressBar`, `LineChart`, `BarChart`,
  `Heatmap`, `DonutChart`, `Sparkline`
- **Content cards** — `ProgramCard`, `WorkoutCard`, `CoachCard`, `RecipeCard`,
  `ProductCard`, `ArticleCard`
- **Shells** — `AppShell` (sidebar + mobile bottom bar), `MarketingHeader`,
  `MarketingFooter`, `PageHeader`

Empty, loading, error and success are first-class components rather than
afterthoughts. A screen that has only ever been seen with good data is a screen
that has not been designed, so every list in the product has an `EmptyState`
with a real sentence and a real next action.

They are wired into the router, not only displayed on this page. The member and
coach segments each have a `loading.tsx` built from `Skeleton` in the shape of
the real content, and an `error.tsx` built from `ErrorState` that offers a retry
and a way back — a failed API call reaches the product's own error screen rather
than Next's default, and the underlying message is logged rather than shown,
since it comes from the API and may name internals. `not-found.tsx` answers the
same question every other screen answers: what should I do next.

### Charts

Hand-built SVG, no charting library. The product needs six chart types, all
small; a library would have cost more bundle weight than the charts themselves
while making them look like somebody else's product.

Every chart is also readable as text: the numbers live in the labels and the
`aria-label`, not only in the geometry. The donut uses one hue at descending
opacity rather than a rainbow, because its categories are one dimension.

## Generated imagery

FORGE ships without a photography library and a prototype that leans on grey
boxes reads as unfinished. Instead every image key deterministically produces a
layered composition from its own characters: an accent bloom, a directional
light sweep, a base gradient, and an SVG grain overlay that gives the result a
photographic surface rather than a flat fill.

The same key always renders the same image; different keys are visibly
different; the palette stays inside the brand. `Media` takes a `src` the moment
real assets exist, and nothing about the layout, aspect ratios or treatment
changes when they do.

## Responsive

Designed at 1440, 1280, 768 and 390.

- **Marketing** — sticky header that goes blurred and opaque on scroll.
- **Member and coach apps** — persistent left sidebar at `lg`, bottom bar with
  five destinations plus a floating primary action below it. Those are not the
  same navigation squeezed into different widths: the mobile bar carries the
  five things somebody standing in a gym needs, and everything else lives
  behind Profile.
- **Workout player** — deliberately outside the app shell. Mid-set, the only
  things on screen should be the movement, the target and the control that logs
  the set. A sidebar full of other places to be is the wrong thing to offer
  somebody under a loaded barbell.
