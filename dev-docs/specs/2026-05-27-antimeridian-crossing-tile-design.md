# Render imagery crossing the antimeridian by cutting tiles in two

- **Date:** 2026-05-27
- **Issues:** [#171](https://github.com/developmentseed/deck.gl-raster/issues/171), [#366](https://github.com/developmentseed/deck.gl-raster/issues/366)
- **Status:** Implemented as unwrap + clip (2026-10-01), superseding the cut-in-two MVP.
- **Prerequisite (merged):** [#517](https://github.com/developmentseed/deck.gl-raster/issues/517) / [#518](https://github.com/developmentseed/deck.gl-raster/pull/518) — multi-world-copy tile traversal
- **Related:** [#182](https://github.com/developmentseed/deck.gl-raster/issues/182), [#351](https://github.com/developmentseed/deck.gl-raster/pull/351) (reprojector sub-domain / cutline), [`dev-docs/coordinate-systems.md`](../coordinate-systems.md), [`dev-docs/world-copies.md`](../world-copies.md)
- **Informed by (not the basis):** [#353](https://github.com/developmentseed/deck.gl-raster/pull/353) (rejected: global proj4 `+over` hack), [#374](https://github.com/developmentseed/deck.gl-raster/pull/374) and [#269](https://github.com/developmentseed/deck.gl-raster/pull/269) (AI-generated unwrap attempts)

## Problem

A single raster whose source extent crosses ±180° longitude does not render correctly in a Web Mercator viewport. This covers:

- A global EPSG:4326 COG whose bounds touch or slightly overhang ±180° (e.g. `[-180.0012, …, 179.9987, …]`), where the dateline-edge tile straddles the seam.
- A genuine crossing scene whose source grid wraps past ±180° (stored with longitudes running e.g. 170° → 190°).

"Antimeridian" decomposes into three problems: **A** — tile *selection* across world copies (#517, fixed in #518); **B** — global-COG mesh divergence (#366); **C** — true crossing imagery (#171). A is merged. This spec addresses **B + C**, which are the same underlying problem at different tile geometries: a tile whose source extent crosses ±180° needs a *continuous* projection to mesh and place correctly.

## Why it's hard

The Web Mercator render path projects each tile through
[`raster-tileset-2d.ts`](../../packages/deck.gl-raster/src/raster-tileset/raster-tileset-2d.ts) `projectPosition`:

```ts
projectPosition = (x, y) => rescaleEPSG3857ToCommonSpace(descriptor.projectTo3857(x, y));
```

`projectTo3857` is proj4 (source CRS → 3857 m). proj4 normalizes longitude to (−180°, 180°], so a tile straddling the dateline has corners at +179° → 3857 x ≈ **+19.9 Mm** (common-x ≈ 510) and +181°/−179° → 3857 x ≈ **−19.9 Mm** (common-x ≈ 2). The `RasterReprojector` (Delatin) mesh triangle spanning those corners covers the whole world, and its pixel-space error never converges (#366: `error=43200` after 10 000 iterations).

**Unwrapping in source-longitude space does not work:** proj4 re-normalizes any longitude you hand it (190° → −170°), re-introducing the jump (dcherian, [#269](https://github.com/developmentseed/deck.gl-raster/pull/269)). Any unwrap must therefore act at/after the transform output — which is what makes the "keep it as one tile" approaches fragile.

## Current approach (2026-10-01): unwrap in the reprojector, clip the mesh

The cut-in-two MVP only handled **vertical** seams: it estimated where the seam was from four corner longitudes and rejected anything else. Slanted (rotated geotransform), curved (e.g. UTM 60N) and world-spanning tiles fell back to a full mesh and diverged again. It was replaced by two operations that make no assumption about seam shape or CRS:

1. **Unwrap in the reprojector.** `RasterReprojector`'s `wrapX` option (the output x period; `TILE_SIZE` for Web Mercator) snaps each new vertex's exact x to the copy nearest its parent triangle's *interpolated* x (`snapToCopy`), which Delatin already computes for its error check. That reference is off only by the reprojection error, far inside the ±half-period tolerance. Seed vertices have no parent, so each is unwrapped along the uv path from the previous one (`unwrapAlong`, bisecting until each step is under a quarter period — needed so a −180..180 tile's corners, x = 0 ≡ 512, don't collapse).
2. **Clip at x = k·512.** `clipMeshToWorld` (deck.gl-raster) clips the finished mesh against each world boundary and shifts every part back into `[0, 512]`, interpolating uv linearly along the cut edge — the same piecewise-linear texture mapping. That boundary *is* the discontinuity, so the cut is exact for any seam shape. One mesh, one layer per tile. The clip (not just the unwrap) is needed because deck.gl only draws the world copies the viewport's bounds cover: a mesh at x ≈ 512..530 vanishes when zoomed tight on the east side alone.

Supporting changes:

- **Projection.** `_projectPosition` goes via the source's own lng/lat (`projectTo4326` → `lngLatToWorld`), so a 4326 source's native longitude (e.g. −204°) maps continuously without wrapping at all. `_unprojectPosition` accepts any copy: the stock 3857 inverse inside `[0, 512]`; outside, x maps linearly to an un-normalized longitude through `projectFrom4326` (passed through by a 4326 source, folded by proj4's `adjlon` for a projected one).
- **Traversal.** Bounding-volume reference points are unwrapped against the tile center with `unwrapAlong`; the dataset bounds pre-filter unwraps the dataset's corners along its perimeter. The two are unwrapped from different anchors (tile centre vs dataset corner), so they can land a world apart — `insideBounds` therefore tests overlap with x periodic (±1 world).
- **Edge tiles.** COGLayer fetches edge tiles clipped to the image (`boundless: false`), so the reprojector's uv already spans only data — a 360° image's 36 px overview never meshes its 640° nominal tile. (MultiCOGLayer fetches boundless; a world-spanning source there would mesh padding.)

Tests: `raster-reproject/tests/wrap-x.test.ts`, `deck.gl-raster/tests/clip-mesh-to-world.test.ts`, `deck.gl-raster/tests/raster-tileset/raster-tileset-2d-antimeridian.test.ts`, and `deck.gl-geotiff/tests/antimeridian-fixtures.test.ts` (every tile of the vertical, rotated, UTM 60N and 360° fixtures through real proj4).

Limit: the refinement snap needs each coarse triangle's interpolation error under half a period (180°). A seed triangle spanning a wildly nonlinear region (a polar stereographic tile over the pole) could break that; seed a denser grid if a polar fixture shows it.
