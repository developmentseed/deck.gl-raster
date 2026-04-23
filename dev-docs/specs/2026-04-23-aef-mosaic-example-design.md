# AlphaEarth Foundations Mosaic Example — Design

## Problem

A new `examples/aef-mosaic` example should visualize the AlphaEarth Foundations
(AEF) GeoZarr Mosaic — a global mosaic of Google's annual Satellite Embedding
dataset (2017–2025) — hosted on Source Cooperative at
`s3://us-west-2.opendata.source.coop/tge-labs/aef-mosaic/` (also reachable via
`https://data.source.coop/tge-labs/aef-mosaic/`).

Each pixel is a 64-dimensional learned embedding quantized to `int8`. The
canonical way to display AEF embeddings is to pick three of the 64 dimensions
and map them to R/G/B. Doing this on the GPU — uploading the full 64-band
stack per tile and switching the three sampled layers via uniforms — gives
instant band-switching with no refetch.

This exercise also drives one change to `ZarrLayer`: the AEF store uses Zarr v3
sharding with a 4096×4096 outer shard and a 256×256 inner chunk. Tiles must be
sized by the inner shard chunk, not the outer shard, or each tile would hold
gigabytes of data.

## Goals

- Render AEF embeddings as an RGB composite of three user-selected bands in a
  MapLibre/deck.gl map.
- Upload all 64 bands of one year to the GPU per tile as a single `r8sint`
  Texture2DArray. Band switching changes three integer uniforms; no refetch.
- Dequantize `int8 → float` inside the shader using `(v/127.5)² · sign(v)`.
- Treat the sentinel `-128` as nodata (transparent pixel).
- Expose year, R/G/B band indices, rescale range, and a preset-location picker
  in a side control panel.
- Update `ZarrLayer` (and its `RasterTileset2D` descriptor wiring) to derive
  the tile size from the inner sharding codec chunk shape when the array uses
  `sharding_indexed`; fall back to `arr.chunks` otherwise.
- Add unit tests covering both the sharded and non-sharded branches of the new
  tile-shape helper.

## Non-Goals

- Cross-year scrubbing. V1 refetches tiles when the year changes; packing all
  9 years × 64 bands (576 layers) into one Texture2DArray is a follow-up.
- Colormap / single-band mode. V1 is RGB-only; the `SampleAefRgb` module
  deliberately combines sample + dequant + rescale because they are tightly
  coupled, but a later colormap pipeline can extract the dequant helper.
- Per-channel rescale. V1 uses one shared `[min, max]` applied to all three
  channels.
- Pixel filtering (`FilterRange`). V1 has rescale only.
- Metadata inference upstream. The store is already GeoZarr-compliant at the
  root group level (`spatial:dimensions`, `spatial:transform`, `spatial:shape`,
  `proj:code`), and `parseGeoZarrMetadata` already handles the
  single-resolution branch. The example passes the array as `source` and the
  root group attrs via the existing `metadata` override prop.
- `ZarrLayer.variable` resolving to an array path. V1 uses the array-as-source
  pattern. Teaching `variable` to detect arrays vs. groups is a separate
  cleanup.
- Globe view. Web Mercator only.
- Animation (year autoplay) and tour mode.

## Design

### Dataset shape

From the store's `zarr.json`:

- **Root group attrs (relevant):**
  - `spatial:dimensions: ["y", "x"]`
  - `spatial:transform: [0.00008983…, 0, -180, 0, -0.00008983…, 83.685…]`
  - `spatial:shape: [1859584, 4009984]`
  - `proj:code: "EPSG:4326"`
  - `geoemb:dimensions: 64`
  - `geoemb:quantization: { formula: "(x/127.5)² · sign(x)", nodata: -128,
    valid_range: [-127, 127] }`
- **Array `embeddings/` (what ZarrLayer reads):**
  - `shape: [9, 64, 1859584, 4009984]` — `[time, band, y, x]`
  - `data_type: "int8"`, `fill_value: -128`
  - `chunk_grid.chunk_shape: [1, 64, 4096, 4096]` (outer shard)
  - Codec: `sharding_indexed` with inner `chunk_shape: [1, 64, 256, 256]`
  - `dimension_names: ["time", "band", "y", "x"]`

Native resolution ≈ 10 m/px (≈ zoom 14). There is no multiscale pyramid.

### Layer wiring

The example opens both the root group (for attrs) and the `embeddings` array
(as the data source), then hands both to `ZarrLayer`:

```ts
const store = new zarr.FetchStore(ZARR_URL);
const root = await zarr.open.v3(store, { kind: "group" });
const arr = await zarr.open.v3(root.resolve("embeddings"), { kind: "array" });

<ZarrLayer
  source={arr}
  metadata={root.attrs}
  selection={{ time: yearIdx, band: null, y: null, x: null }}
  getTileData={getTileData}
  renderTile={renderTile}
  …
/>
```

`parseGeoZarrMetadata` handles the single-resolution branch
(`parse.ts:91–113`): with no `multiscales:` key, it emits one level backed by
`spatial:shape` + `spatial:transform`. No upstream parser change required.

The AEF store does not publish consolidated metadata, so the root `open` call
does issue a handful of per-node `zarr.json` fetches. Acceptable at startup.

### Selection

`{ time: yearIdx, band: null, y: null, x: null }` — pins the year and leaves
all 64 bands in the returned tile. Per the layer's existing semantics, the
spatial dims get tile-bounded slices and non-spatial dims are filled from
`selection`.

### getTileData

```
zarr.get(arr, sliceSpec) → Chunk<int8>
  shape [1, 64, H, W], data: Int8Array
```

Because `time` is pinned to a single index (`selection.time = yearIdx`), the
chunk's leading axis has length 1. C-order memory layout is
`band * H * W + row * W + col`, which matches a `depth = 64` Texture2DArray
indexed by band. One `device.createTexture` call with
`format: "r8sint", dimension: "2d-array", depth: 64, data`. No transpose.

Per-tile GPU memory: `256 × 256 × 64 × 1 byte = 4 MiB`. For larger inner
chunks later (e.g. 512²) it scales to 16 MiB; still fine for the layer's
default cache.

### renderTile

Returns `{ renderPipeline: [{ module: SampleAefRgb, props: { ... } }] }`.
Props come from current state: `dataTex`, `rBandIdx`, `gBandIdx`, `bBandIdx`,
`rescaleMin`, `rescaleMax`.

### `SampleAefRgb` GPU module

Combined sample + dequantize + rescale. Fragment shader (GLSL 300 ES):

```glsl
uniform highp isampler2DArray sampleAefRgb_dataTex;
uniform int sampleAefRgb_rBandIdx;
uniform int sampleAefRgb_gBandIdx;
uniform int sampleAefRgb_bBandIdx;
uniform float sampleAefRgb_rescaleMin;
uniform float sampleAefRgb_rescaleMax;

int fetchBand(vec2 uv, int band) {
  return texture(sampleAefRgb_dataTex, vec3(uv, float(band))).r;
}

float dequantAef(int v) {
  float f = float(v) / 127.5;
  return f * f * sign(f);
}

vec4 sampleAefRgb_fs_color(vec4 color, vec2 uv) {
  int ri = fetchBand(uv, sampleAefRgb_rBandIdx);
  int gi = fetchBand(uv, sampleAefRgb_gBandIdx);
  int bi = fetchBand(uv, sampleAefRgb_bBandIdx);
  if (ri == -128 || gi == -128 || bi == -128) discard;

  vec3 rgb = vec3(dequantAef(ri), dequantAef(gi), dequantAef(bi));
  float invSpan = 1.0 / (sampleAefRgb_rescaleMax - sampleAefRgb_rescaleMin);
  rgb = clamp((rgb - sampleAefRgb_rescaleMin) * invSpan, 0.0, 1.0);
  return vec4(rgb, 1.0);
}
```

Integer textures (`isampler2DArray`) force `nearest` filtering — acceptable,
matches the other GPU modules in this repo. Default rescale `[-0.3, 0.3]`
based on Earth Engine's published AEF visualizations.

### Upstream `ZarrLayer` change: tile size from inner shard chunk

**File:** `packages/deck.gl-zarr/src/zarr-layer.ts`

Replace the two lines

```ts
const tileWidth = arr.chunks[arr.chunks.length - 1]!;
const tileHeight = arr.chunks[arr.chunks.length - 2]!;
```

and the corresponding `chunkSizes` construction in `renderTileLayer` with a
helper:

```ts
function getTileShape(
  arr: zarr.Array<zarr.DataType, zarr.Readable>,
): [number, number] {
  const sharding = findShardingCodec(arr);
  const shape = sharding?.configuration.chunk_shape ?? arr.chunks;
  return [shape[shape.length - 2]!, shape[shape.length - 1]!];
}
```

`findShardingCodec` walks the array's codec pipeline (zarrita's
`arr.codec`/codec list — exact member name confirmed at implementation time)
and returns the first codec with `name === "sharding_indexed"`, or `undefined`.

Both call sites — `_getTileData` and `renderTileLayer` — use the helper so the
tileset descriptor and the per-tile slice computation stay in sync.

**Rationale:** without this, the AEF store produces 4096×4096 tiles with
64-layer textures → ~1 GiB per tile. Other sharded stores would have the same
problem. Treating the inner chunk as authoritative for tiling is correct in
general; the outer shard is an I/O grouping, not a display unit.

**Ripple effect:** the non-sharded examples (`dynamical-zarr-ecmwf`,
`zarr-sentinel2-tci`) exercise the fallback branch — `arr.chunks` — so no
regression expected. Verified by typechecks + existing tests + local run.

### Example file layout

```
examples/aef-mosaic/
├── package.json               # mirrors dynamical-zarr-ecmwf deps
├── index.html
├── tsconfig.json
├── vite.config.ts
├── README.md
└── src/
    ├── main.tsx
    ├── App.tsx                # top-level state + MapLibre + ZarrLayer
    ├── aef/
    │   ├── constants.ts       # YEAR_ORIGIN=2017, NODATA=-128, etc.
    │   ├── band-labels.ts     # fetch `band` coord → string[64]
    │   ├── get-tile-data.ts   # zarr.get → r8sint Texture2DArray (depth=64)
    │   ├── render-tile.ts     # build {renderPipeline} from state
    │   ├── selection.ts       # buildSelection({ yearIdx })
    │   └── locations.ts       # preset location list
    ├── gpu/
    │   └── sample-aef-rgb.ts  # shadertools module
    └── ui/
        └── control-panel.tsx  # year slider, location dropdown, band dropdowns, rescale slider
```

### Control panel

- **Year slider:** 9 stops (2017 → 2025). Changing year re-keys the `ZarrLayer`
  `id` (suffix `-year-${yearIdx}`) to discard the previous year's cached
  tiles, mirroring the ECMWF example's init-time handling.
- **Location dropdown:** 4–6 preset regions (`id`, `label`, `longitude`,
  `latitude`, `zoom`). Selecting one calls `mapRef.current.flyTo(...)`.
- **R / G / B dropdowns:** each lists the 64 labels from the `band` coord
  (fetched once at mount). Default triad: first, middle, last band — or a
  chosen triad that looks good over the default location, decided at
  implementation time.
- **Rescale range slider:** shared `[min, max]`, default `[-0.3, 0.3]`, range
  `[-1, 1]`. One Radix slider with two thumbs.
- **Hide-layer-below-minZoom:** if `viewport.zoom < 12`, return `[]` from the
  layers array. Simpler than clamping; lets the user see the basemap at
  context.

### Default view

Initial camera aimed at the first preset location (likely San Francisco Bay).
Zoom level 13–14 so tiles load immediately.

### Testing

- Unit test: `getTileShape` returns inner chunk when a `sharding_indexed`
  codec is present; returns `arr.chunks` otherwise.
- Manual verification: open the example, confirm (a) tiles load at zoom 13–14,
  (b) band dropdowns change the display without refetching, (c) year slider
  refetches, (d) nodata pixels at the AEF bbox boundary render transparent,
  (e) no regression on `dynamical-zarr-ecmwf` and `zarr-sentinel2-tci`.
- Typecheck at repo root.

## Open Questions

None blocking. Decisions deferred to implementation time:

- Exact zarrita API for codec inspection (`arr.codec` vs. `arr.codecs` etc.).
- Initial default band triad — probably chosen empirically once the example
  renders.

## Follow-Ups (explicitly out of scope)

1. Cross-year scrubbing via a 576-layer Texture2DArray.
2. Colormap mode with single-band selection.
3. Per-channel rescale.
4. `FilterRange` integration.
5. Teach `ZarrLayer.variable` to handle array paths so callers don't have to
   pre-open both group and array.
