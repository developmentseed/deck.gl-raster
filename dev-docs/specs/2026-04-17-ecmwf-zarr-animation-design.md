# ECMWF Zarr Animation Example — Design

## Problem

The new `examples/dynamical-zarr-ecmwf` example needs to visualize a single
scalar variable from the ECMWF IFS ENS 15-day forecast dataset hosted by
Dynamical.org. The dataset is a Zarr v3 store that is **not** GeoZarr-compliant,
has a 5-dimensional layout `[init_time, lead_time, ensemble_member, lat, lon]`,
and uses a WMO spherical CRS rather than EPSG:4326. We want to animate the
variable over forecast lead time (hours 0–360) using a WebGL2 Texture2DArray so
that the time dimension can be scrubbed on the GPU without refetching data.

This exercise also serves as a forcing function for the `ZarrLayer` API: we
want to understand what a generic "Zarr tile → user-controlled rendering"
interface looks like in practice, so that the layer can support diverse Zarr
layouts (not just pre-visible 2D imagery like Sentinel-2 TCI).

## Goals

- Render ECMWF `temperature_2m` (or another simple scalar variable) as a
  colormapped raster in a MapLibre/deck.gl map.
- Animate over `lead_time` (85 frames) by updating a single GPU uniform — no
  re-fetching, no shader recompilation.
- Use `zarrita.js` for slicing.
- Refactor `ZarrLayer` to:
  - Make `getTileData` and `renderTile` required (no default `ImageData`
    pipeline).
  - Accept a synthetic `GeoZarrAttrs` override so non-GeoZarr stores can be
    used.
  - Expose a `selection` prop for non-spatial dimension indexing.
- Update the existing `examples/zarr-sentinel2-tci` to the new API (moving its
  `ImageData` pipeline into the example as the reference pattern for
  pre-visible imagery).
- Keep all ECMWF-specific code (metadata, GPU module, tile handling, UI) in the
  example; no changes to packages other than `deck.gl-zarr`.

## Non-Goals

- Metadata inference utility. The example hardcodes a GeoZarr attrs object for
  ECMWF. Inference from raw Zarr attributes can come later once we have more
  than one non-GeoZarr dataset.
- Generic `RasterTileLayer` base class shared between `COGLayer` and
  `ZarrLayer`. Premature until a second consumer exists.
- Cross-chunk animation (animating across `init_time`). The current chunk shape
  puts all 85 `lead_time` values in a single chunk, so a single-chunk animation
  is sufficient for now.
- Variable switching UI, ensemble picker UI, init_time picker UI. Each is
  pinned in the first pass.
- Half-float (`r16float`) path. Stay at `float32` unless memory becomes a real
  constraint.
- Transpose fallback in the dim-order validator. Error out and document the
  required layout; implement transpose when a dataset actually demands it.
- Globe view. Web Mercator only; polar rows will be clipped by the existing
  `makeClampedForwardTo3857`.
- Half-float Float16Array conversion utilities.

## Design

### CRS treatment

The dataset declares a WMO spherical CRS (radius 6,371,229m). This is
angularly identical to EPSG:4326 but uses a perfect sphere rather than the
WGS84 ellipsoid. At 0.25° native resolution the geodetic offset is sub-pixel
everywhere, so we treat the data as EPSG:4326 for rendering. The hardcoded
GeoZarr metadata declares `EPSG:4326` directly.

Web Mercator cannot render latitudes above ±~85.051°, so the top and bottom
rows of the grid fall off the map. This is handled by the existing
`makeClampedForwardTo3857` in the reprojection path; no new code needed.

### Chunk layout and selection

Variable arrays have shape `[747, 85, 51, 721, 1440]` with chunk shape
`[1, 85, 51, 320, 320]`. Pinning `init_time` and `ensemble_member` reduces a
single chunk read to `[85, 320, 320]` float32 (≈33 MB per interior spatial
tile). All 85 lead times come back in one zarrita call — ideal for uploading
as a Texture2DArray depth-stack.

The full spatial grid is 721 × 1440 at 0.25°. Split across 320×320 chunks,
that's 3 × 5 = 15 tiles (edge tiles are smaller because 721 and 1440 don't
divide evenly by 320). Worst-case total GPU memory with all tiles resident:
`85 × 721 × 1440 × 4 bytes = ~337 MB`. In practice `TileLayer` evicts
out-of-view tiles, so the working set is smaller.

### `ZarrLayer` refactor

Changes to `packages/deck.gl-zarr/src/zarr-layer.ts`:

1. **Drop the default `ImageData` rendering path.** `getTileData` and
   `renderTile` become required props. The COGLayer discriminated-union pattern
   collapses to a straight required pair.

2. **Generalize the tile-data type parameter** following `COGLayer`:
   `ZarrLayer<DataT extends MinimalDataT>`. `renderTile` receives the
   user-shaped `DataT` and returns a `RenderTileResult` (a sublayer).

3. **Replace `dimensionIndices` with a required `selection` prop:**
   ```ts
   selection: Record<string, number | zarr.Slice | null>;
   ```
   Semantics match zarrita's own: `number` pins (dim collapses), `zarr.Slice`
   keeps a range (dim passes through), `null` keeps the full dim. Validated at
   layer initialization: every non-spatial named dim of the array must appear
   as a key. Missing keys throw; no silent defaults.

4. **Add `metadata?: GeoZarrAttrs` prop.** When provided, skip
   `parseGeoZarrMetadata(group.attrs)` and use this object instead. Never
   mutate the user's group attrs.

5. **Dim-order validator** in `_parseZarr`. After opening the variable array,
   assert: last two dim names are the GeoZarr-declared y/x (in that order),
   all other dims precede them. Throw a descriptive error on mismatch.
   No transpose fallback.

6. **Forward `updateTriggers.renderTile`** into the inner `TileLayer`'s
   `renderSubLayers` so uniform-only changes don't trigger tile refetches.

7. **`_getTileData` hands the user the opened `zarr.Array` plus the computed
   slice spec.** The layer computes tile-bounds → spatial slices and composes
   them with the user's `selection`, but does not call `zarr.get` internally.
   The user's `getTileData` callback drives the fetch.

### Update `zarr-sentinel2-tci` example

Pull the current `ImageData` pipeline (today internal to `ZarrLayer`) into the
example as its own `getTileData` / `renderTile`. This both keeps the Sentinel-2
demo working under the new API and establishes a reference pattern for "the
Zarr store already holds pre-visible uint8 imagery."

### ECMWF example GPU pipeline

The custom render pipeline composes one new module with two existing ones:

```ts
renderPipeline: [
  { module: SampleTexture2DArray, props: { dataTex, layerIndex } },  // NEW (example-local)
  { module: LinearRescale, props: { rescaleMin: -40, rescaleMax: 50 } },
  { module: Colormap, props: { colormapTexture } },
]
```

Pipeline flow:
1. `SampleTexture2DArray` reads `texture(dataTex, vec3(geometry.uv, layerIndex)).r`,
   discards NaN fill, and writes the scalar value into `color.rgb`.
2. `LinearRescale` maps `[rescaleMin, rescaleMax]` → `[0, 1]` (existing module).
3. `Colormap` samples the 1D colormap at `color.r` (existing module).

The new module injects into `fs:#decl` (declare `sampler2DArray`) and
`fs:DECKGL_FILTER_COLOR` (sample + nan check + assign). Its uniforms are
`layerIndex: f32` and the `dataTex` binding.

Sampler filtering is nearest — WebGL2 linear filtering on `r32float` requires
an extension we don't need for time-step animation, where we want sharp frame
selection anyway.

### Tile fetch and GPU upload

`getTileData(arr, options)`:
1. `const result = await zarr.get(arr, options.sliceSpec)` → `Float32Array`
   shaped `[85, H, W]`.
2. `device.createTexture({ dimension: '2d-array', format: 'r32float',
   width: W, height: H, depth: 85, sampler: { minFilter: 'nearest',
   magFilter: 'nearest' } })`.
3. Upload the typed array directly (C-order; `lead_time` is the outermost dim,
   which matches `texImage3D`'s `[depth, height, width]` layout).
4. Return `{ texture, width: W, height: H, byteLength: result.data.byteLength }`.

NaN fills stay as NaN in the texture and are handled by the shader.

### Rendering: `renderTile` with `RasterLayer`

`renderTile(data)` returns a `RasterLayer` configured with the custom pipeline.
This reuses `RasterReprojector`-generated mesh reprojection from
`deck.gl-raster` — we inherit the correct Web Mercator reprojection and pole
clamping for free.

The `image` prop on `RasterLayer` is omitted (the pipeline samples a
Texture2DArray directly). `renderPipeline` holds the three modules described
above.

### Animation

Animation lives entirely in the example's React state. `ZarrLayer` is
animation-agnostic.

- `leadTimeIdx: number` React state (0..84).
- `isPlaying: boolean` toggle.
- A `useEffect` running `requestAnimationFrame` with a time accumulator
  advances `leadTimeIdx` by 1 every ~200ms while playing. Chosen over
  `setInterval` because `rAF` auto-pauses when the tab is hidden and synchronizes
  with the display refresh.
- `leadTimeIdx` threads into the `renderTile` closure and into
  `updateTriggers.renderTile` so deck.gl re-renders sublayers on change.

### Preserving GPU state across animation frames

Every animation frame must only update the `layerIndex` uniform — no shader
recompilation, no buffer reallocation, no texture re-upload. Invariants to
maintain:

- Shader module objects (`SampleTexture2DArray`, `LinearRescale`, `Colormap`)
  are top-level imports with stable identity. Never constructed inside
  `renderTile` or component bodies.
- `data.texture` (the Texture2DArray) persists across animation renders —
  `TileLayer` caches `getTileData` results and the `Texture` is reused.
- `colormapTexture` is created once (e.g., inside `useMemo` or at module scope)
  and passed by reference.
- The `renderPipeline` array has `compare: true` in RasterLayer's defaultProps,
  so deck.gl structurally compares entries and only flows prop changes through
  `getUniforms` when a prop actually changed.

**Verification during implementation** (not part of this design, but to flag
in the plan):
- Inspect WebGL shader compilation events in Chrome DevTools — should fire
  once per tile on load, not once per animation frame.
- Monitor GPU memory across playback — should be flat.

### File layout

```
examples/dynamical-zarr-ecmwf/
  src/
    App.tsx                        # Map + ZarrLayer + animation state + UI panel
    main.tsx                       # (existing)
    ecmwf/
      metadata.ts                  # Hardcoded GeoZarr attrs + lead_time schedule
      selection.ts                 # Builds the `selection` record
      get-tile-data.ts             # zarrita slice → Texture2DArray upload
      render-tile.ts               # Constructs the RasterLayer with pipeline
    gpu/
      sample-texture-2d-array.ts   # New shader module (example-local)
      colormap.ts                  # 256-sample LUT + Texture creation helper
    ui/
      control-panel.tsx            # Play/pause + slider + lead_time display
```

### UI

Control panel overlay in the existing `zarr-sentinel2-tci`-style position:

- Play/pause toggle button.
- Slider bound to `leadTimeIdx` (0..84).
- Text display: "Lead time: +X hours" computed from the ECMWF schedule
  (3-hourly to 144h, then 6-hourly to 360h). The hours array is a constant in
  `ecmwf/metadata.ts`.

No init_time picker, no ensemble picker, no variable picker in this pass.

## Open Questions / Future Work

- What set of non-GeoZarr datasets should drive generalizing the hardcoded
  metadata into an inference utility? Currently deferred.
- Whether to promote `SampleTexture2DArray` into `deck.gl-raster` — revisit
  after at least one more consumer wants a `sampler2DArray`-based pipeline.
- Color-legend UI for the colormap. Out of scope for the first prototype.
- Cross-chunk animation (iterating over `init_time` or longer time series).
