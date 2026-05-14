# Idea: GCP COG Visualization

**Status:** Future work. Not currently implemented.

**Related:** [geotiff-georef-type-split.md](geotiff-georef-type-split.md) is a cleaner foundation for this work and should likely happen first (or alongside) — without it, the GCP path either makes `RasterArray.transform` virally nullable or requires a hacky placeholder.

**Origin:** Brainstormed and designed during exploratory work on `kyle/cog-gcp-explore`. The original feasibility writeup lives at `dev-docs/plans/gcp-rendering-feasibility.md` (gitignored, on-branch only).

## Problem

`COGLayer` currently throws when opening a GeoTIFF whose georeferencing is supplied as Ground Control Points (GCPs) rather than as an affine geotransform — `createTransform` in [`packages/geotiff/src/transform.ts`](../../packages/geotiff/src/transform.ts) raises `"The image does not have an affine transformation"` when no `ModelPixelScaleTag` / `ModelTransformationTag` is present, even though the file does carry valid georeferencing in `ModelTiepointTag`. Sentinel-1 GRD products and many scanned-map and L1 satellite COGs fall into this bucket.

The recent affine-tileset refactor ([dev-docs/specs/2026-04-27-affine-tileset-design.md](../specs/2026-04-27-affine-tileset-design.md)) made `TilesetLevel` polymorphic with the explicit intent of accepting a future GCP implementation alongside `AffineTilesetLevel`, but didn't ship one. The `RasterReprojector` core in [`packages/raster-reproject/src/delatin.ts`](../../packages/raster-reproject/src/delatin.ts) is already CRS-agnostic — it consumes arbitrary `forwardTransform` / `inverseTransform` callbacks, so it doesn't need to change.

The hard part of the original "long-term" plan — fitting a non-linear model to GCPs with both forward and inverse evaluation — is provided by [`@allmaps/project`](https://www.npmjs.com/package/@allmaps/project) (transform types: `straight`, `helmert`, `polynomial` 1–3, `projective`, `thinPlateSpline`; all with forward and inverse). MIT, pure ESM, browser-safe.

## Goals

- Render COGs georeferenced by Ground Control Points end-to-end through `COGLayer` (and `MultiCOGLayer`) without changes to consumer code beyond detecting the variant.
- Add `GcpTilesetLevel` and `GcpTileset` as siblings to `AffineTilesetLevel` / `AffineTileset` in `@developmentseed/deck.gl-raster`, both implementing the existing `TilesetLevel` / `TilesetDescriptor` interfaces.
- Surface `gcps` on `GeoTIFF` in `@developmentseed/geotiff`. Existing `geotiff.crs` works for both variants — GeoTIFF stores one CRS in `GeoKeyDirectoryTag` regardless of whether georeferencing is affine or GCP, so a separate `gcpCrs` property is unnecessary.
- Support multiple `@allmaps/project` transform types as a `GcpTilesetLevel` constructor option, defaulting to `polynomial` (order 1) for stability.
- Validate against a real Sentinel-1 GRD VH scene (210 GCPs in 21×10 grid, EPSG:4326). The exact test asset used during design exploration: `s3://sentinel-s1-l1c/GRD/2026/4/26/IW/DV/S1D_IW_GRDH_1SDV_20260426T231832_20260426T231857_002524_0042D6_2BC9/measurement/iw-vh.tiff`.

## Non-Goals

- **RPC support.** Different math (rational polynomials with elevation), different reader, different model. Reuses ~70% of this work but is its own project.
- **GCP-exact mesh seeding for `RasterReprojector`.** The original short-term plan called for seeding the Delatin mesh from a Delaunay triangulation of GCPs to force pixel-exact pass-through at GCP locations. With `@allmaps/project` providing a smooth model, this is a refinement worth deferring until a concrete need surfaces.
- **3D / terrain-aware reprojection using GCP `z` values.** Allmaps's 2D API ignores `z`. Real elevation handling is a much bigger feature (DEM lookup) and out of scope.
- **Configurable fit CRS (a.k.a. `internalProjection`).** v1 fits the model in the file's GCP CRS only; see Design §1. A constructor option to override (for polar / high-distortion scenes) is a natural follow-up.
- **Unit tests against a fixture COG.** Deferred until [`geotiff-test-data`](https://github.com/developmentseed/geotiff-test-data) gets a GCP fixture; v1 ships with visual verification only.

## Design

### 1. Source CRS = file's GCP CRS, symmetric with the affine path

`AffineTileset`'s source CRS is whatever the file's CRS is (e.g. EPSG:4326, UTM zone, Mollweide); `projectTo3857` is a real proj4 reprojection.

**`GcpTileset`'s source CRS is the same thing — the file's GCP CRS** (the CRS declared in the GeoTIFF's GeoKeyDirectory, e.g. EPSG:4326 for Sentinel-1 GRD). `@allmaps/project`'s `ProjectedGcpTransformer` is configured with `internalProjection = viewportProjection = gcpCrs`: the polynomial / TPS fit happens in the file's CRS, and `transformer.transformForward(pixel)` returns coordinates in the file's CRS. `projectTo3857` is a real proj4 reprojection — identical shape to the affine path.

This means both paths produce a `TilesetDescriptor` with the same notion of "source CRS" (= file CRS) and the same kind of `projectTo3857` callback. The only thing that differs between paths is the *implementation* of `level.tileTransform`: an affine for one, a GCP-fitted model for the other. Layer code, the `RasterReprojector`, and the descriptor contract are unchanged across paths.

**Why fit in file CRS rather than 3857** — for the default of polynomial order 1, the fit result is functionally indistinguishable across CRS choices: a linear fit on a dense regular GCP grid is dominated by GCP placement error, not metric anisotropy. For higher-order fits (TPS, polynomial-3) the choice matters more, but no single CRS is universally right:

- mid-latitudes: 3857 is better-conditioned than 4326 (3857 is locally isotropic in meters; 4326 mixes anisotropic degree units)
- polar (>~70°): 3857 is *worse* than 4326; UTM or polar stereographic are right
- equatorial: 4326 ≈ 3857

The right choice is a per-dataset call. v1 takes the boring, intuitive default (= file CRS), avoids the source-CRS-relabeling that a 3857-fit configuration would require, and **leaves room to revisit**: a future `internalProjection` constructor option on `GcpTilesetLevel` lets users pick a metric CRS (3857, UTM, etc.) for higher-order fits when needed.

The implementation should leave a comment near the `ProjectedGcpTransformer` construction explaining this default and pointing at the eventual override hook.

### 2. New primitive: `GcpTilesetLevel`

**Location**: `packages/deck.gl-raster/src/raster-tileset/gcp-tileset-level.ts`

A class implementing `TilesetLevel`, parameterized by GCPs (in their on-file CRS), the GCP CRS string, the transform type, tile size, array size, and meters-per-CRS-unit:

```ts
new GcpTilesetLevel({
  gcps: GcpPair[],          // [{ resource: [px, py], geo: [x, y] }, ...]
  gcpCrs: "EPSG:4326",      // CRS the `geo` values are in (also the fit CRS)
  transformationType: "polynomial",  // optional, default
  polynomialOrder: 1,                // optional, default
  arrayWidth, arrayHeight,
  tileWidth, tileHeight,
  mpu,                      // meters per CRS unit (1 for metric CRSes, ≈111000 for 4326)
});
```

Internally constructs a single `ProjectedGcpTransformer` with `internalProjection = viewportProjection = gcpCrs` — the fit happens in the file's CRS and `transformForward` emits coords in the file's CRS. (See §1 for the rationale and the eventual override hook for non-default fit CRS.)

`TilesetLevel` methods:

- `matrixWidth` / `matrixHeight` — `ceil(arraySize / tileSize)`.
- `metersPerPixel` — sample the forward transformer at the array center plus center+(1,0) and center+(0,1); take `sqrt(|det J|) * mpu` of the 2×2 Jacobian. The `mpu` factor mirrors `AffineTilesetLevel` and converts CRS units to meters for LOD selection.
- `projectedTileCorners(col, row)` — four `transformer.transformForward` calls for the tile's corner pixel coordinates.
- `tileTransform(col, row)` — closures over the global transformer, offset by `(col·tw, row·th)` in pixel space:
  - `forwardTransform(x, y) = transformer.transformForward([x + offsetX, y + offsetY])`
  - `inverseTransform(cx, cy) = transformer.transformBackward([cx, cy]) - [offsetX, offsetY]`
- `crsBoundsToTileRange(minX, minY, maxX, maxY)` — see §3.

`projectedBounds` is the bbox of all per-tile bboxes computed in §3, in the file's CRS.

### 3. Tile-bounds via `Flatbush`

For `AffineTilesetLevel`, `crsBoundsToTileRange` is a single inverse-affine of the four CRS corners followed by a pixel-space bbox. That fails for non-affine fits — the inverse of a CRS bbox isn't a bbox, and inverse iteration can be unstable near the domain edge for high-order polynomial fits.

`GcpTilesetLevel` solves this by **forward-precomputing each tile's CRS bbox at level construction and indexing in a `Flatbush` rtree**:

- For each tile `(col, row)`, forward-sample 8 points in pixel space — 4 corners + 4 edge midpoints — through the transformer.
- Compute `[minX, minY, maxX, maxY]` of the resulting points, in the file's CRS.
- Add to a single `Flatbush` instance (one per level).

`crsBoundsToTileRange` becomes `index.search(minX, minY, maxX, maxY)`, then convert flat tile indices to `(col, row)` and take the bbox of those.

`Flatbush` is already a dep — used in [`packages/deck.gl-geotiff/src/mosaic-layer/mosaic-tileset-2d.ts`](../../packages/deck.gl-geotiff/src/mosaic-layer/mosaic-tileset-2d.ts) — and is faster and more memory-efficient than `rbush`. Construction cost is N×M `transformForward` calls per level (negligible for typical COGs; ~hundreds of ms for very large rasters). Memory cost is ~16 bytes/entry plus the float bboxes themselves; a 150k-tile level is a few MB, summed geometrically across overviews.

The 8-sample mitigation handles non-convex tile shapes that can occur for severely warped TPS fits, where corner-only sampling would under-cover the true tile footprint.

### 4. New primitive: `GcpTileset`

**Location**: `packages/deck.gl-raster/src/raster-tileset/gcp-tileset.ts`

Mirrors `AffineTileset`: holds levels and the four projection callbacks; derives `projectedBounds` from the coarsest level. The projection callbacks are real proj4 reprojections from the file's GCP CRS to/from EPSG:3857 and EPSG:4326 — exactly the same shape as the affine path's projection callbacks.

### 5. GeoTIFF reader changes

**Location**: `packages/geotiff/src/gcp.ts` (new), `packages/geotiff/src/geotiff.ts` (modify).

Add `gcps: Gcp[] | null` to `GeoTIFF`, populated via `parseGcps(cachedTags.modelTiepoint)` during the static factory. The `Gcp` interface mirrors the `ModelTiepointTag` row layout (`pixel`, `line`, `k`, `x`, `y`, `z`); the parser returns `null` for the affine variant (single tie point) and the no-georeferencing case.

The existing `geotiff.crs` getter works unchanged for both variants — GeoTIFF stores exactly one CRS in `GeoKeyDirectoryTag` regardless of the georeferencing mode, so no `gcpCrs` property is needed.

**Open question (significant): how does tile fetching work for GCP variants?** The current `geotiff.fetchTile` path bakes a per-tile affine into `RasterArray.transform`, which doesn't make sense for GCP COGs. Three viable shapes, none of them ideal in isolation:

1. **Type-split `GeoTIFF` / `Overview` / `Tile` / `RasterArray`** — see [geotiff-georef-type-split.md](geotiff-georef-type-split.md). The principled fix; resolves this question cleanly. Likely the prerequisite for shipping this idea.
2. **Add a separate `fetchTilePixels` method that returns un-wrapped decoded data** — sidesteps `RasterArray.transform` for GCP tiles. Smaller scope but introduces a parallel API.
3. **Use a placeholder identity transform** — `RasterArray.transform` is set to identity for GCP tiles. `Tile.array.transform` becomes a footgun (presents a meaningful-looking field that's secretly wrong). The render pipeline doesn't read it, so this is technically safe today, but fragile against future code.

Recommendation: do (1) first, then this work fits naturally on top.

### 6. COG glue: `geoTiffToDescriptor` becomes a dispatcher

**Location**: `packages/deck.gl-geotiff/src/geotiff-tileset.ts` (modify).

The current single-purpose factory becomes a small dispatcher with an explicit discriminated `kind` field:

```ts
type GeoTiffDescriptorOptions =
  | (DescriptorProjections & { kind: "affine" })
  | (DescriptorProjections & { kind: "gcp"; gcpCrs: string });

export function geoTiffToDescriptor(
  geotiff: GeoTIFF,
  opts: GeoTiffDescriptorOptions,
): AffineTileset | GcpTileset;
```

Both branches take the same `DescriptorProjections` (`projectTo3857`, `projectFrom3857`, `projectTo4326`, `projectFrom4326`, `mpu`). The GCP branch additionally needs `gcpCrs` to configure the allmaps transformer.

Two internal helpers:

- `createAffineTileset(geotiff, opts)` — extracted from the current factory body, unchanged behavior.
- `createGcpTileset(geotiff, opts)` — new. For each IFD (full + each overview), scales the full-resolution GCPs into that IFD's pixel grid by `(width / fullWidth, height / fullHeight)`, builds a `GcpTilesetLevel`, and assembles a `GcpTileset`.

Public API surface adds `GcpTileset`, `GcpTilesetLevel`, options interfaces, and `Gcp` (the geotiff-side type).

### 7. COGLayer / MultiCOGLayer wiring

**Location**: `packages/deck.gl-geotiff/src/cog-layer.ts`, `packages/deck.gl-geotiff/src/multi-cog-layer.ts` (modify).

The existing call to `geoTiffToDescriptor` branches on `geotiff.gcps != null`. Both branches use the same `mpu` derivation and the same projection-callback construction; the only differences are which CRS feeds those callbacks and which `kind` is passed:

- Affine path: source CRS = `crsFromGeoKeys(geotiff.gkd)` (i.e. `geotiff.crs`), `mpu` from `metersPerUnit(crs.units, ...)`, `kind: "affine"`. Unchanged behavior.
- GCP path: source CRS = `geotiff.crs` (same getter, same value), same `mpu` derivation, `kind: "gcp"`, plus the same value formatted as an EPSG string. The four `projectTo*` / `projectFrom*` callbacks are real proj4 reprojections — the existing helpers (`makeClampedForwardTo3857`, etc.) work as-is.

The `RasterReprojector` plumbing inside `RasterTileLayer` does not change — both paths produce a `TilesetDescriptor` whose `level.tileTransform(x, y)` returns the right `forwardTransform` / `inverseTransform` callbacks.

### 8. Tests

- `packages/geotiff/tests/gcp.test.ts` covering `parseGcps` (null cases, malformed input, multi-tiepoint parsing).
- No new unit tests for `GcpTilesetLevel` initially — full coverage requires a fixture COG, deferred until `geotiff-test-data` ships one. Visual verification against the Sentinel-1 GRD test scene is the initial acceptance gate.

## Open questions

1. **`ProjectedGcpTransformer`'s exact constructor signature.** The 1.0.0-beta.x API for `gcpCrs` / `internalProjection` / `viewportProjection` / `transformationOptions` should be confirmed against the installed package's `.d.ts` during implementation; if option names differ, adjust the call site without changing the design.
2. **`proj4` deduplication in pnpm.** `@allmaps/project` brings its own `proj4` dep. The workspace already uses `proj4`; pnpm should dedupe, but verify with `pnpm ls proj4 --depth 2` after install. If two copies appear, pin via `pnpm.overrides`.
3. **Beta dependency churn.** `@allmaps/project` is `1.0.0-beta.8`; expect minor API changes before 1.0. Pin tightly in `package.json`. Plan a churn-tracking pass before any 1.0 of `@developmentseed/deck.gl-raster`.
4. **Configurable fit CRS (`internalProjection`).** Default of file-CRS fit is fine for polynomial-1 but not optimal for higher-order or TPS at non-equatorial latitudes. A `GcpTilesetLevel` constructor option to override the internal projection is the natural extension — `ProjectedGcpTransformer` already supports it. Defer until a concrete failing case appears.

## Why deferred

The clean way to ship this requires the type-split refactor in [geotiff-georef-type-split.md](geotiff-georef-type-split.md). Without that, the GCP fetch path either makes `RasterArray.transform` virally nullable, introduces a parallel `fetchTilePixels` API, or relies on a placeholder identity transform that's a footgun for future maintenance. None of those tradeoffs are worth shipping for the current state of demand.

When this work resumes:

1. Decide on the type-split (do it first, or commit to one of the workaround shapes in §5 option 2/3).
2. Re-validate `@allmaps/project`'s exact API against whatever's current at the time.
3. Acquire (or hard-code) the Sentinel-1 test asset into `examples/cog-basic`.
4. Walk the design above, adjusting for whichever foundation ended up under it.
