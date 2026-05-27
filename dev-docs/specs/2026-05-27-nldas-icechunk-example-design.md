# NLDAS icechunk example — Design

- **Date:** 2026-05-27
- **Issues:** [#569](https://github.com/developmentseed/deck.gl-raster/issues/569)
- **Status:** Proposed
- **Related:** [`2026-04-17-ecmwf-zarr-animation-design.md`](2026-04-17-ecmwf-zarr-animation-design.md) — the closest precedent example; this design deliberately strips its UI down to a static frame

## Problem

We want an example proving that an [icechunk](https://icechunk.io) repository can
be read in the browser and rendered with `deck.gl-raster`, using
[`icechunk-js`](https://github.com/EarthyScience/icechunk-js) as a
zarrita-compatible store. icechunk is increasingly used to publish analysis-ready
and *virtual* Zarr (chunks that reference byte ranges inside other cloud objects),
and we currently have no example demonstrating that path.

The target dataset, suggested in the issue, is
[NLDAS-3](https://github.com/virtual-zarr/nldas-icechunk) — NASA's North American
Land Data Assimilation System v3 daily forcing data, virtualized into an icechunk
repo:

- **Repo:** `https://nasa-waterinsight.s3.us-west-2.amazonaws.com/virtual-zarr-store/NLDAS-3-icechunk`
- **Access:** public / anonymous.
- **Virtual chunks:** reference the original NLDAS-3 files under
  `s3://nasa-waterinsight/NLDAS3/forcing/daily/` — **the same bucket**.

Feasibility facts verified during design:

- The entire `nasa-waterinsight` bucket returns `Access-Control-Allow-Origin: *`
  for `GET`/`HEAD`, so both the icechunk repo metadata and the virtual source
  objects are reachable from a browser origin.
- `icechunk-js@0.4.0` declares `zarrita ^0.5 || ^0.6 || ^0.7` as a peer
  dependency, matching this repo's `zarrita@0.7.3`.
- The repo's `config.yaml` declares exactly one virtual chunk container:
  ```yaml
  virtual_chunk_containers:
    s3://nasa-waterinsight/NLDAS3/forcing/daily/:
      url_prefix: s3://nasa-waterinsight/NLDAS3/forcing/daily/
      store: !s3 { region: us-west-2, anonymous: false, ... }
  ```
  The container's underlying objects are nonetheless publicly readable over
  HTTPS (verified), so the browser can fetch them unsigned despite
  `anonymous: false` in the stored config.

The working Python recipe (provided by @kylebarron) confirms what the browser
code must replicate:

```python
storage = icechunk.s3_storage(bucket='nasa-waterinsight',
    prefix="virtual-zarr-store/NLDAS-3-icechunk", region="us-west-2", anonymous=True)
virtual_credentials = icechunk.containers_credentials({
    "s3://nasa-waterinsight/NLDAS3/forcing/daily/": icechunk.s3_anonymous_credentials()})
repo = icechunk.Repository.open(storage=storage,
    authorize_virtual_chunk_access=virtual_credentials)
session = repo.readonly_session('main')
ds = xr.open_zarr(session.store, consolidated=False, zarr_version=3, chunks={})
```

Two requirements fall out of this: **region** `us-west-2` (in the browser this is
just encoded in the HTTPS host — `icechunk-js` has no region param), and
**explicit authorization of the virtual chunk container** before chunk reads
work.

## Goals

- A new `examples/nldas-icechunk` that renders a single Tair (air temperature)
  timestep over North America with a temperature colormap.
- Exercise the real integration seam: `IcechunkStore` → `zarrita.open` →
  `ZarrLayer` (the existing `@developmentseed/deck.gl-zarr` layer).
- Reuse this repo's idiomatic GPU colormap pipeline (rescale + colormap on the
  GPU via `deck.gl-raster`'s gpu-modules), as in the ECMWF example.
- `pnpm typecheck` passes and `pnpm dev` shows the rendered frame.

## Non-goals

- **No animation and no UI controls.** This is a minimal "plumbing" demo — one
  pinned timestep, a fixed colormap, and a fixed rescale range. A time slider and
  colormap/rescale controls are obvious follow-ups but explicitly out of scope.
- **No GeoZarr support work.** The NLDAS virtual store is not GeoZarr-compliant;
  we hard-code synthetic spatial attrs (the established ECMWF approach) rather
  than teaching anything to parse NLDAS's native layout.
- **No icechunk version-control UI** (snapshots/tags/branches). The example
  checks out the default `main` branch only.

## Design

### Directory layout

Mirrors `examples/dynamical-zarr-ecmwf`, minus the control-panel UI:

```
examples/nldas-icechunk/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  README.md
  src/
    main.tsx            React entry
    App.tsx             open store -> open Tair -> build ZarrLayer -> map + overlay
    nldas/
      metadata.ts       REPO_URL, VARIABLE, TIME_INDEX, rescale range,
                        colormap choice, hard-coded NLDAS_GEOZARR_ATTRS
      get-tile-data.ts  zarr.get(arr, sliceSpec) -> Float32 tile {data,width,height,byteLength}
      render-tile.ts    GPU rescale + colormap pipeline (trimmed ECMWF render-tile)
```

No Chakra UI — there are no controls. Dependencies: `icechunk-js@^0.4.0`,
`zarrita`, the workspace deck.gl-raster / deck.gl-zarr packages, the deck.gl
peer packages, `maplibre-gl`, `react-map-gl`, and the shared
`deck.gl-raster-examples-shared` (`DeckGlOverlay`).

### Data flow

1. **Open (once, on mount).** Build the store with the virtual chunk container
   authorized. The `virtualChunkContainers` option lives on `ReadSession.open`
   (not on `IcechunkStore.open(url, …)`), so we construct the session explicitly
   and wrap it:
   ```ts
   const storage = new HttpStorage(REPO_URL); // region encoded in the HTTPS host
   // VCC name (from config.yaml) -> public HTTPS prefix for the source objects
   const virtualChunkContainers = new Map([[
     "s3://nasa-waterinsight/NLDAS3/forcing/daily/",
     "https://nasa-waterinsight.s3.us-west-2.amazonaws.com/NLDAS3/forcing/daily/",
   ]]);
   // exact entry point (Repository.checkoutBranch vs ReadSession.open with an
   // explicit snapshot id) is pinned at the smoke-test step below
   const session = await /* main-branch read session */;
   const store = await IcechunkStore.open(session); // withRangeCoalescing is fn-typed; omit
   const arr = await zarr.open(store.resolve("/Tair"), { kind: "array" });
   ```
   Use `zarr.open.v3` if auto-detection misfires — icechunk is always Zarr v3.
   Assert the dtype is float; throw with a clear message otherwise (ECMWF
   precedent). No custom `FetchClient` is needed: the source objects are public,
   so the default client's unsigned `fetch` succeeds.
2. **Colormap.** Fetch the shipped `colormaps.png`, `decodeColormapSprite` to
   `ImageData`, and `createColormapTexture` once the luma `Device` arrives via
   the overlay's `onDeviceInitialized` callback. Identical to ECMWF.
3. **Layer.** Construct
   `ZarrLayer({ node: arr, metadata: NLDAS_GEOZARR_ATTRS, selection: { <timeDim>: TIME_INDEX }, getTileData, renderTile, maxRequests })`.
   The layer tiles the single-level array; `getTileData` pulls one chunk per tile
   via `zarr.get(arr, options.sliceSpec)`; `renderTile` applies the fixed rescale
   + colormap on the GPU.
4. **Map.** A `maplibre-gl` basemap centered on North America (≈ lon −98, lat 39,
   zoom ≈ 3.5) with the shared `DeckGlOverlay` (interleaved).

### Spatial metadata (the one non-obvious piece)

NLDAS-3 virtual-zarr is not GeoZarr-compliant, so — exactly like ECMWF's
`ECMWF_GEOZARR_ATTRS` — we hard-code a synthetic attrs object and pass it as
`ZarrLayer`'s `metadata` prop:

```ts
{
  "spatial:dimensions": [<yDim>, <xDim>],   // e.g. ["lat", "lon"]
  "spatial:transform": [a, b, c, d, e, f],  // @developmentseed/affine convention
  "spatial:shape": [height, width],
  "proj:code": "EPSG:4326",
}
```

The **exact grid values** (spatial dim names, the non-spatial time dim name,
shape, origin, pixel size, and crucially the latitude **row direction**) are not
guessed — they are read from the store once during implementation by logging
`arr.shape` and reading the 1-D lat/lon coordinate arrays, then frozen into
`metadata.ts` with a comment recording where they came from. Tair's units
(likely Kelvin) are confirmed the same way and drive a fixed rescale range plus a
temperature colormap choice.

### Error handling

- Async open effect uses a `cancelled` flag (ECMWF precedent) to avoid setting
  state after unmount.
- Non-float dtype throws with a descriptive message.
- Layer is only constructed once both the opened array and the colormap texture
  are ready.

## Risks / smoke-test before building UI

- **Virtual chunk resolution — the load-bearing risk.** Mechanism is understood
  (the `virtualChunkContainers` map above), but two unknowns remain until run: the
  exact session entry point that accepts `virtualChunkContainers`
  (`Repository.checkoutBranch` vs `ReadSession.open` with an explicit snapshot id),
  and whether the manifest stores chunk locations such that the container's
  `url_prefix` matches and rewrites cleanly to the HTTPS prefix. **First
  implementation step is a throwaway script/console call** that opens the store
  and `zarr.get`s a single Tair chunk, confirming bytes return, *before* any
  layer/UI work. If it fails, revisit the approach here rather than pressing on.
- **Zarr version.** icechunk is Zarr v3 with no consolidated metadata; the store
  serves metadata directly. Prefer `zarr.open.v3` if plain `open` mis-detects.

## Testing

Examples in this repo are demos without unit tests; verification is:

- `pnpm typecheck` in the example.
- Manual `pnpm dev` confirming Tair renders over North America with the colormap.

A fresh worktree first needs submodule init + `pnpm install` + `pnpm build` so the
workspace packages resolve.
