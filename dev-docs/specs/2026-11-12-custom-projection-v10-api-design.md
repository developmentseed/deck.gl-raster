# Custom Projection Example: Track deck.gl v10's API

- **Date:** 2026-11-12
- **Issues:** updates the example from [#694](https://github.com/developmentseed/deck.gl-raster/pull/694); informs [#695](https://github.com/developmentseed/deck.gl-raster/issues/695) (library support for custom projections)
- **Status:** Accepted (Kyle, 2026-11-12)

Code links are pinned to main at
[`5b55894f`](https://github.com/developmentseed/deck.gl-raster/commit/5b55894f3306867f2ae77166f6b71d2d8f6535f9).
Upstream links are pinned to deck.gl `v10.0.0-alpha.1`
([`78067bff`](https://github.com/visgl/deck.gl/commit/78067bff4f951169e02cbbe486ca9399078d1675))
and to the merge of visgl/deck.gl#10741
([`c762d6b3`](https://github.com/visgl/deck.gl/commit/c762d6b31c5cd8ba94c3bde4e589268659268996)),
which the example's stand-in copied in October.

## Why

deck.gl published `10.0.0-alpha.1` on 2026-11-12. Kyle wants to evaluate the
custom projection example against it, without moving development to v10:
"it's ok for ongoing development to be against 9.4". Of the options discussed,
he picked updating the example's deck.gl 9.4 stand-in for
`_CustomProjectionView` to match v10's current API: "that at least shows me
visually how upstream is changing".

## What changed upstream

Between the stand-in's source (visgl/deck.gl#10741, 2026-10-06) and
`v10.0.0-alpha.1`:

| | October (#10741) | `v10.0.0-alpha.1` |
| --- | --- | --- |
| Projection input | `projection: {forward, inverse}`, plus `fromCrs`, `toCrs` | **`crs`**: an EPSG code, PROJ string, WKT or PROJJSON, resolved by math.gl's `projectionEngine.getCRS` into a `CRSDescriptor` |
| Resolution | synchronous | **asynchronous**: `view.initialize()`, which `Deck` awaits (visgl/deck.gl#10865) |
| World coordinates | `fromCrs` | **always WGS84** |
| Domain | `fromBounds`, a lng/lat clamp | **projection-owned** `crs.converter.WGS84.normalize`. For polar stereographic it clamps latitude at 150° from the pole, i.e. 60° past the equator (per upstream's test app) |
| Conversions | `viewport.preproject` / `postUnproject` | `viewport.crs.converter.WGS84.from` / `to`. The round-trip check is gone; non-finite results become NaN (visgl/deck.gl#10835) |
| Meter scales | `getDistanceScale` callback, or an estimate | `crs.getRenderingScale` (the Jacobian), sampled into a texture |
| `projectionSignature` | `[fromCrs, toCrs, resolution]` | `[crs.signature, resolution]` |
| `resolution` | maximum cell size in `fromCrs` units | subdivision intervals around the Earth; default 0 |

Unchanged: the `NORMALIZATION_SCALE` zoom convention, `projectFlat` and
`unprojectFlat`, the pitch and bearing controller, and tiled layers being
unsupported.

## Approaches

1. **A draft PR on the v10 alpha, never merged.** Not now: it means porting
   about 9,500 lines of `deck.gl-raster` and `deck.gl-geotiff` to v10.
2. **v10 copies of those two packages inside the example, merged to main.**
   Not now: it duplicates the library in an example.
3. **Picked:** keep the example on deck.gl 9.4 and update its stand-in to
   alpha.1's API.

Within option 3, there were two ways to resolve `crs`:

- **math.gl 5's projection engine** (my call). It's what alpha.1 itself calls,
  so the example shows upstream's real extents, clamps and conversions.
- **An imitation of the descriptor built on proj4.** Lighter, but it would
  test our copy of upstream, not upstream.

## Goals

- The stand-in's public API matches alpha.1's `_CustomProjectionView` and
  `_CustomProjectionViewport`: the `crs` prop, `initialize()`, `viewport.crs`,
  a WGS84 `center`, `projectionSignature`, and `projectFlat` /
  `unprojectFlat`. `project`, `unproject` and `projectPosition` stay in map
  meters: the stand-in extends deck.gl 9.4's `OrthographicViewport`, which
  sends cartesian positions through `projectPosition`.
- The rest of the example (the app, `ProjectedCOGLayer` and the context
  layers) uses only members that alpha.1's viewport has. Moving to v10 is
  then an import swap: math.gl's `projectionEngine.getCRS` in place of the
  stand-in's `resolveCRS`, then deleting the stand-in, keeping
  `pixelToWorld`.
- Projection behavior comes from `@math.gl/geospatial` `5.0.0-beta.8`, the
  version deck.gl `10.0.0-alpha.1` pins.
- `ProjectedCOGLayer` takes no projection props: its domain comes from the
  view's CRS, so its `fromBounds` prop goes away.

## Non-goals

- Depending on deck.gl v10, or changing anything under `packages/`.
- Pitch and bearing. Upstream's controller has them, but the layer's level of
  detail assumes a top-down camera.
- deck.gl doing the projection for vector layers (`coordinateSystem` CRS
  strings, visgl/deck.gl#10874) and `BitmapLayer`'s `_projectionTolerance`.
  The context layers keep projecting on the CPU.
- The meter-scale texture. Every context layer sizes in pixels.

## Design

**Stand-in** ([`src/custom-projection/`](https://github.com/developmentseed/deck.gl-raster/tree/5b55894f3306867f2ae77166f6b71d2d8f6535f9/examples/experimental/custom-projection/src/custom-projection)):

- The view takes `crs` and `resolution`. `initialize()` resolves `crs`
  through a module-level cache around `projectionEngine.getCRS`, keyed like
  upstream's `resolveCRS`, and rejects a CRS that isn't projected.
  `makeViewport` returns `null` until then, and calls `initialize()` itself,
  because deck.gl 9.4 never does. Left out of upstream's API: `orthographic`,
  and `equals` comparing structured `crs` objects by content (every preset is
  a string).
- The viewport takes `crs: CRSDescriptor`. Its scale is the constant
  `NORMALIZATION_SCALE`, so it accepts meter-based CRSs only: deck.gl 9.4's
  `Viewport` constructor calls `projectFlat` before a subclass can store a
  per-CRS scale. Its camera target is `from(normalize(center))`, and its
  signature is `[crs.signature, resolution]`. `projection`, `fromCrs`,
  `toCrs`, `fromBounds`, `preproject` and `postUnproject` go away.
- Beside some maps math.gl's inverse returns a wrapped longitude instead of
  throwing, so `pixelToWorld` and the camera's world center keep the old
  stand-in's round-trip check.
- The controller still wraps `OrthographicController`. It converts between
  `center` and `target` through the descriptor.

**Layer** ([`src/projected-cog-layer/`](https://github.com/developmentseed/deck.gl-raster/tree/5b55894f3306867f2ae77166f6b71d2d8f6535f9/examples/experimental/custom-projection/src/projected-cog-layer)):

- `CustomProjectionViewportLike` in `projection-context.ts` becomes
  `{projectionSignature, crs, projectFlat}`. `sourceToMap` is
  `from(normalize(lngLat))`. `mapToLngLat` uses `to`, and keeps a finite and
  round-trip check: upstream dropped its own, but tile selection still has to
  reject extrapolated inverses.
- The domain is a lng/lat rectangle derived from `normalize`: latitude
  limits from normalizing each pole, full longitude. It replaces the
  `fromBounds` prop, and the tileset's rectangle-based culling and trimming
  stay as they are.

**App, presets and context layers:**

- Presets carry `crs` instead of `toCrs` and `fromBounds`. Web Mercator uses
  `EPSG:3857`, as upstream's test app does. The others keep their PROJ
  strings, because math.gl only knows a few EPSG codes (4326, 3857, UTM, UPS).
- The app resolves the preset's CRS with `resolveCRS` before handing the
  view to `DeckGL`, and keeps the previous projection on screen meanwhile.
  The context layers need the descriptor too, so this wait stays after the
  move to v10, through math.gl's `projectionEngine.getCRS`.
- The context layers project through the descriptor. The domain outline and
  the graticule follow the derived domain.
- `proj4` moves to `devDependencies`: after this change only the tests use
  it.
- The README says the stand-in tracks `v10.0.0-alpha.1`.

## What will look different

- **Arctic and Antarctic:** the map reaches 60° past the equator instead of
  20°. The domain outline, coastlines and tile coverage follow. Zoomed out,
  global rasters fetch tiles further into the far hemisphere.
- Equal Earth and Web Mercator should look the same.

## Risks

- math.gl 5 beta is bundled next to the math.gl 4 that deck.gl 9.4 uses, and
  `@math.gl/arrow` has `apache-arrow` as a peer dependency. Check the install,
  the bundle size, and that importing the projection entry doesn't pull in
  Arrow.
- math.gl's `stere` has to handle the presets' parameters, such as
  `+lat_ts`. Spot-check each preset against proj4 at a few points.
- Found while adding the dependency: pnpm resolved the
  `@math.gl/web-mercator` peer of `@deck.gl/mapbox` in `examples/_shared` to
  the 5.0 beta, despite the peer range `^4.1.0`. That would have reached every
  example with a MapLibre overlay. `examples/_shared` now declares
  `@math.gl/web-mercator: ^4.1.0` itself.

## Verification

- Typecheck, build and `biome check`.
- Every preset and dataset, checked in headed Chrome through
  chrome-devtools-mcp. Before and after screenshots of each preset go to Kyle
  for the PR.
- The math.gl vs proj4 spot-check results go in the PR description, not in a
  test.

## Calls I made

- Use math.gl 5's engine rather than a proj4 imitation.
- Follow upstream's extent, and drop `fromBounds`.
- Keep the stand-in top-down only.
- Derive the domain rectangle from `normalize`.

## Follow-up for Kyle

- Whether to post the "What changed upstream" table to #695.
