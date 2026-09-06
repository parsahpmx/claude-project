# FORGE Web design system

Dark-first. The product is read in a gym, outdoors in daylight, and on top of
map tiles, so the ground is ink and the accent has to survive being drawn over
terrain.

## The accent

FORGE V1 used `#E8462B`, a red-orange. It sat close enough to a well-known
competitor's identity to read as borrowed, which the brief rules out directly.

The web accent is a **signal lime, `#B8E62E`**:

| Use | Contrast |
| --- | --- |
| As text on ink-900 | 13.5:1 |
| As a surface with ink-900 text on top | 13.5:1 |
| On ink-800 (raised cards) | 14.3:1 |

It is also unmistakable over the greens, greys and blues of a map, and it is
nobody else's brand colour.

**It is a UI colour, not a chart fill.** At L 0.86 it glares as a filled shape
on near-black — the palette validator rejects it for that use. Chart fills take
`signal-700` `#7FA018`, which sits inside the dark-mode lightness band and
still clears 3:1 against the chart surface.

## Tokens

| Token | Value | For |
| --- | --- | --- |
| `ink-900` | `#0B0B0C` | Page ground |
| `ink-800` | `#141417` | Raised card |
| `ink-700` | `#1C1C21` | Hover, inputs |
| `ink-600` | `#26262C` | Borders |
| `bone-100` / `bone-200` | `#FBFAF7` / `#F4F2ED` | Primary and body text |
| `smoke-400` | `#9C9CA4` | Secondary text — 7.2:1 on ink-900 |
| `signal-500` | `#B8E62E` | The accent |
| `signal-700` | `#7FA018` | Chart fills |
| `state-*` | good / warn / bad / info | Status, never the only carrier of meaning |

**Secondary text is a colour, never an opacity.** `opacity-50` on body copy
reads as hierarchy and measures as a contrast failure, and it compounds when
applied to text that is already muted. `.muted` carries a real token.

## Type scale

One scale, used everywhere: `hero`, `display`, `page-title`, `section`,
`card-title`, `body`, `secondary`, `caption`, `metric-xl`, `metric-l`,
`button`. Sizes that scale with the viewport use `clamp()` so a headline works
from 390 px to 1440 px without a breakpoint.

Metrics are set with `tabular-nums` wherever digits line up in a column.

## Imagery

Route geometry drawn as SVG, not photography.

FORGE has no photo library and no photography budget, and a fitness site full
of generic gym stock looks like every other fitness site. A GPS trace is the
product's own material, it is legible at any size, it costs nothing to ship,
and it is deterministic from a seed — so the same route renders identically on
the server and the client and can never cause a hydration mismatch.

## Layout

- `shell` — max 1440 px with a fluid gutter.
- Desktop navigation is a **top bar**, not a sidebar: this is a place you read
  and browse, and a 248 px rail would take width from the map, which is the one
  screen that genuinely needs it (§7).
- Mobile gets a bottom bar, thumb-reachable, with a 58 px minimum row.
- Every interactive target is at least 44 px.

## Components

`Button` and `ButtonLink` (4 variants × 3 sizes), `Card`, `Metric`, `Badge`,
`Field`, `EmptyState`, `ErrorState`, `Skeleton`, `MapCanvas`, `RouteSummary`,
`ActivityCard`, `WeeklyVolumeChart`, `TopNav`, `BottomNav`.

Closed variant sets rather than `className` passthrough: forty screens built
from open-ended components drift within a week.

## Charts

- A single series needs no legend — the heading names it.
- Rounded data-ends anchored to the baseline, a 2 px gap between bars, one
  recessive gridline rather than a full grid.
- Selective direct labels (peak and current), never a number on every bar.
- Text wears text tokens; the mark carries identity.
- A `<details>` table view accompanies every chart, so the data is never
  reachable only through a picture.
- Hover is a native SVG `<title>`: no JavaScript, and screen readers announce it.

## Motion

`ease-forge` (`cubic-bezier(0.22, 1, 0.36, 1)`), 200 ms for state, 500 ms for
progress. Everything is decoration, and `prefers-reduced-motion` disables all of
it.
