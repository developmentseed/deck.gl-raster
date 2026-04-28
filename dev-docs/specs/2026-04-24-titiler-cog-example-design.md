# Titiler COG example design

## Goal

A prototype example that renders map tiles fetched from a titiler server as
`.npy` numpy arrays, decoded client-side, and drawn with
`RasterTileLayer` from `@developmentseed/deck.gl-raster`.

The value proposition: unlike `COGLayer` and `ZarrLayer`, which parse the
source file's metadata on the frontend, here the frontend has no direct
access to the source image — it only talks to a tile server that hands
back per-tile binary arrays. Any backend that serves `.npy` tiles for an
OGC tile matrix set can plug into `RasterTileLayer` the same way.

This is also the first example in the repo that uses `RasterTileLayer`
directly (not via a `COGLayer` / `ZarrLayer` subclass).

## Non-goals

- A dataset picker. One hardcoded COG URL.
- A general-purpose "TitilerLayer" package. Kept as example-local code.
- Support for non-8-bit outputs (e.g. 16-bit Sentinel-2 L2A bands). Only
  `uint8` npy is accepted; other dtypes throw with a clear message.
- Reactive URL / parameter changes at runtime. The COG URL is static.
- Unit tests. Examples in this repo are not tested.

## Server

Uses the public `https://titiler.xyz` instance. Two endpoints:

- `GET /cog/info?url=<COG_URL>` — returns metadata including
  `bounds: [west, south, east, north]` in WGS84. Used to fit the map.
- `GET /tileMatrixSets/WebMercatorQuad` — returns an OGC TMS 2.0 JSON
  document. Used to build the `TilesetDescriptor`.
- `GET /cog/tiles/WebMercatorQuad/{z}/{x}/{y}.npy?url=<COG_URL>` — returns
  a numpy `.npy` file for one tile, shape `(bands, height, width)`,
  dtype `uint8` for an RGB COG. For a 3-band RGB source titiler returns
  4 bands: R, G, B, mask.

The COG URL is the Sentinel-2 TCI one already used in `cog-basic`:
`https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A/TCI.tif`.

## Directory layout

Mirrors `examples/cog-basic`:

```
examples/titiler-cog/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  src/
    App.tsx
    main.tsx
```

The app is small enough that no further subdivision is warranted. If the
UI grows later (e.g. dataset picker, band pickers), split out a
`components/` directory — for now, everything lives in `App.tsx`.

## Dependencies

- `@deck.gl/core`, `@deck.gl/geo-layers`, `@deck.gl/layers`,
  `@deck.gl/mapbox`
- `@developmentseed/deck.gl-raster` (workspace) — provides
  `RasterTileLayer`, `TileMatrixSetAdaptor`, and the gpu-modules
  (`CreateTexture`, `MaskTexture`).
- `@developmentseed/morecantile` (workspace) — for the `TileMatrixSet`
  type used to type the response from `/tileMatrixSets/WebMercatorQuad`.
- `@developmentseed/proj` (workspace) — for `proj4` EPSG:3857 ↔ 4326
  transforms. (CRS is fixed here, no epsg-resolution is needed.)
- `npyjs` — decodes the `.npy` response.
- `maplibre-gl`, `react`, `react-dom`, `react-map-gl`.

Dev dependencies: `vite`, `@vitejs/plugin-react`, `@types/react`,
`@types/react-dom`, `gh-pages`, `typescript` (whatever the existing
examples use).

## Runtime data flow

1. Mount. App is in a "loading" state with no tile layer.
2. Two fetches kick off in parallel:
   - `GET /cog/info?url=<COG_URL>` → `{ bounds, ... }`.
   - `GET /tileMatrixSets/WebMercatorQuad` → OGC `TileMatrixSet`.
3. Both resolve.
   - Build EPSG:3857 ↔ 4326 projection functions once.
     - `projectTo3857` and `projectFrom3857` are identity (WebMercatorQuad's
       CRS _is_ EPSG:3857).
     - `projectTo4326` / `projectFrom4326` wrap `proj4("EPSG:3857",
       "EPSG:4326").forward` / `.inverse`.
   - `tilesetDescriptor = new TileMatrixSetAdaptor(tms, { projectTo3857,
     projectFrom3857, projectTo4326, projectFrom4326 })`.
   - Stash the descriptor in state. Call `mapRef.current.fitBounds(bounds)`.
4. `RasterTileLayer` renders with the descriptor, `getTileData`, and
   `renderTile` props (below).
5. For each tile deck.gl requests, `getTileData` runs once; the result
   is cached by the inner `TileLayer` (configured via the raster tile
   layer's `maxCacheSize`/`maxCacheByteSize`).

## `getTileData`

```
async function getTileData(tile, { device, signal }) {
  const url = `https://titiler.xyz/cog/tiles/WebMercatorQuad/${tile.index.z}/${tile.index.x}/${tile.index.y}.npy?url=${encodeURIComponent(COG_URL)}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`titiler ${response.status}: ${await response.text()}`);
  }
  const buffer = await response.arrayBuffer();
  const { data, shape, dtype } = new npyjs().parse(buffer);
  // Validate shape and dtype — throw if unexpected.
  // Expect shape = [B, H, W] with B ∈ {3, 4} and dtype === "uint8".
  const [bands, height, width] = shape;
  const rgba = repackBandSeparateToRGBA(data, bands, height, width);
  const texture = device.createTexture({
    data: rgba,
    format: "rgba8unorm",
    width,
    height,
    sampler: { minFilter: "linear", magFilter: "linear" },
  });
  let mask;
  if (bands === 4) {
    const maskBand = data.subarray(3 * height * width, 4 * height * width);
    mask = device.createTexture({
      data: maskBand,
      format: "r8unorm",
      width,
      height,
      sampler: { minFilter: "nearest", magFilter: "nearest" },
    });
  }
  return {
    width,
    height,
    byteLength: rgba.byteLength + (mask ? height * width : 0),
    texture,
    mask,
  };
}
```

`repackBandSeparateToRGBA` is a tight loop: for each output pixel index
`i` in `0..H*W`, copy `data[0*HW+i]`, `data[1*HW+i]`, `data[2*HW+i]`
into `rgba[i*4..i*4+3]`, and set `rgba[i*4+3] = 255`. (The 4th band is
the mask, handled separately.)

The returned object satisfies `MinimalTileData` and carries `texture` /
`mask` through to `renderTile`.

## `renderTile`

```
function renderTile(data) {
  const renderPipeline = [
    { module: CreateTexture, props: { textureName: data.texture } },
  ];
  if (data.mask) {
    renderPipeline.push({ module: MaskTexture, props: { maskTexture: data.mask } });
  }
  return { renderPipeline };
}
```

Both `CreateTexture` and `MaskTexture` are already exported from
`@developmentseed/deck.gl-raster/gpu-modules`.

## UI

One top-left collapsible info panel, styled like `cog-basic`:

- Title: "Titiler + RasterTileLayer".
- Paragraph: "Tiles are fetched as numpy `.npy` arrays from `titiler.xyz`,
  parsed and uploaded as textures client-side, and rendered via
  `RasterTileLayer`."
- Link: titiler documentation (`https://developmentseed.org/titiler/`).
- "Show Debug Mesh" checkbox wired to `debug` state; when on, a
  "Debug Opacity" slider bound to `debugOpacity` state. Both are passed
  through as `RasterTileLayer` props.

Initial `viewState`: `{ longitude: 0, latitude: 0, zoom: 2 }`. On info
resolve, `mapRef.current.fitBounds([[w, s], [e, n]], { padding: 40,
duration: 1000 })`.

Loading state: the map renders with no tile layer. The info panel
renders normally (it's not blocked on the fetches). No spinner.

Error state: if either startup fetch fails, replace the paragraph with
an error message. Per-tile fetch errors are surfaced by deck.gl's own
tile error handling and do not block the app.

## Resilience

- Tile fetches pass the `AbortSignal` from `getTileData`'s `options`,
  so cancelled tiles don't hold open requests.
- Non-2xx responses throw with a message including the status code and
  body text, so failures are visible in the console.
- A clear `Error` is thrown when the npy dtype is not `uint8` or the
  shape has fewer than 3 bands. No silent fallback.

## File sizes (rough)

- `src/App.tsx`: ~180 lines (UI + map setup + the two startup fetches +
  `getTileData` + `renderTile`). If it blows past ~250 lines, split the
  tile fetch helpers into `src/titiler.ts` and the UI panel into
  `src/components/InfoPanel.tsx`.
- `index.html`, `main.tsx`, `package.json`, `tsconfig.json`,
  `vite.config.ts`: standard Vite boilerplate copied from `cog-basic`.

## Open questions

None at spec time. If `npyjs` turns out to have an awkward ESM/CJS
packaging story under Vite, we fall back to a ~40-line inline parser
(the format is trivial for the dtypes we care about).
