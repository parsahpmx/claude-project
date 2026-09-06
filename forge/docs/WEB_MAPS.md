# Maps

## Provider choice

**MapLibre GL JS + OpenStreetMap-derived tiles.**

| Option | Licence cost | Notes |
| --- | --- | --- |
| **MapLibre GL** | None (BSD-3) | Chosen. A fork of Mapbox GL JS from before the licence change. |
| Mapbox GL JS | Per map load | Good product. Per-load billing is the wrong shape for a beta whose traffic is unknown. |
| Google Maps | Per load | Same shape, plus terms that constrain caching. |
| MapKit JS | Free with limits | Apple-account bound; awkward for a web beta and for non-Apple users. |

§28 asks for a choice made on cost and terms rather than prestige. MapLibre is
the renderer; the recurring cost is **tiles**, which is a separate decision.

## Tiles are the actual cost

The renderer is free. Tiles are not, and this is where a map architecture
quietly becomes the dominant line item.

| Source | Cost shape | Suitable for |
| --- | --- | --- |
| `demotiles.maplibre.org` | Free, rate-limited | **Development only.** Currently the default in `.env.example`, and it must not be pointed at beta traffic. |
| OSM standard tiles | Free, but the tile usage policy forbids app use at scale | Not suitable |
| MapTiler / Stadia free tier | Free to a monthly request ceiling, then per-request | A plausible beta answer |
| Protomaps on object storage | Storage + egress only, no per-request fee | Best long-run cost; needs a build step and a hosting bucket |

**Recommendation for beta:** a hosted free tier while user numbers are in the
tens, with Protomaps as the migration target once traffic makes per-request
pricing the largest cost. Both are a one-line change:
`NEXT_PUBLIC_MAP_STYLE_URL`.

**This is not yet decided, and nothing in the product depends on the decision.**

## Bundle cost

MapLibre is loaded with a dynamic `import()` inside the map component, so it is
fetched only on screens that draw a map. The build confirms this: `/maps` adds
1.21 kB to a 102 kB shared baseline. Home, Training and Progress never download
a mapping runtime (§123).

## When tiles fail

The component reports it and the page keeps working. Distance, climbing,
splits and pace all live outside the map, and `RouteSummary` renders the route
as a definition list and a screen-reader sentence.

This is the §82 requirement — core route information is never map-only — and it
doubles as the offline and rate-limited story.

## What is not built

- **Route builder.** Drawing a line is easy; snapping it to real paths and
  getting distance and climbing right needs a routing provider, which is
  another cost decision. `/routes/new` says this rather than shipping a builder
  that reports wrong numbers.
- **Global heatmap.** Off, and no data is being collected for it. The
  `aggregate_contribution` consent exists and is off; the product tells the
  truth about it rather than implying a crowd layer exists.
- **Segments and live segments.** Post-beta.

## Cost discipline for routing, when it arrives

§104: debounce, do not request per mouse move, and cache what the provider's
terms allow. Nothing requests routing today, so there is nothing to regress yet.
