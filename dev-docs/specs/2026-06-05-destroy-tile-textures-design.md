# Destroy tile textures on eviction — Design

- **Date:** 2026-06-05
- **Issues:** [#591](https://github.com/developmentseed/deck.gl-raster/issues/591)
- **Status:** Proposed

## Problem

When a tile is evicted from deck.gl's `TileLayer` cache, the GPU texture(s) we
uploaded for that tile are never freed. A luma.gl `Texture` is a thin JS wrapper
around a WebGL texture handle that holds GPU memory; JS garbage collection will
eventually reclaim the *wrapper object* but does **not** deterministically free
the underlying GL resource — luma.gl requires an explicit `.destroy()`. deck.gl's
own [`onTileUnload` docs](https://deck.gl/docs/api-reference/geo-layers/tile-layer#ontileunload)
state that the caller owns anything returned from `getTileData`, and passing a
texture as a uniform/binding to a `RasterLayer` sublayer does **not** transfer
ownership — luma only auto-destroys textures it created itself.

The result is a GPU-memory leak that accumulates as the user pans and zooms.

`onTileUnload` is the correct lifecycle hook: it fires on **cache eviction**, not
when a tile merely scrolls off-screen. A tile that goes off-screen but stays in
cache is re-shown without re-fetching, so destroying on off-screen would be wrong.
Eviction is the precise moment a tile's textures are provably no longer needed.

The leak exists in two places:

1. **The library's own default pipelines.** `COGLayer`'s default render pipeline
   creates a `texture` (+ optional `mask`) per tile
   (`packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts`), and `MultiCOGLayer`
   creates one texture per band (`packages/deck.gl-geotiff/src/multi-cog-layer.ts`).
   Neither is ever destroyed.
2. **Examples with custom `getTileData`.** Several examples upload their own
   textures via `device.createTexture()` and never free them.

## Ownership model

The fix follows a single principle: **whoever creates a texture frees it.**

- The library creates textures only inside its own default pipelines. It should
  destroy them — but *only* when its default pipeline actually ran.
- A user who supplies a custom `getTileData` (or `getn`) owns the tile data and
  its textures, and is responsible for freeing them in their own `onTileUnload`.
  The library must not reach into a user-shaped `tile.data` and assume a texture
  lives at `.texture`.

This keeps the library's behavior predictable: passing `getTileData` means "I own
this tile's resources."

## Layer-by-layer

| Layer | Creates textures? | Library cleanup? |
| --- | --- | --- |
| `RasterTileLayer` (base) | No default pipeline | None — returns user `onTileUnload` unchanged |
| `COGLayer` | Only when `!props.getTileData` | Destroy `tile.data.texture` + `tile.data.mask`, **only** when default pipeline ran |
| `MultiCOGLayer` | Always (no user-`getTileData` path) | Always destroy every `tile.data.bands[*].texture` |
| `ZarrLayer` | Never (requires user `getTileData`) | None |

## Wiring

Add a protected `_onTileUnloadCallback()` hook on `RasterTileLayer`, mirroring the
existing `_getTileDataCallback()` / `_renderTileCallback()` / `_tilesetDescriptor()`
override pattern. The base `renderLayers` passes its result to the inner
`TileLayer` in place of `this.props.onTileUnload`.

- **Base `RasterTileLayer`**: returns `this.props.onTileUnload` unchanged.
- **`COGLayer`** overrides it: when `!this.props.getTileData`, compose a destroyer
  of `tile.data.texture` + `tile.data.mask` with the user's `onTileUnload`;
  otherwise return the user's `onTileUnload` untouched.
- **`MultiCOGLayer`** overrides it: always compose a destroyer that walks
  `tile.data.bands.values()` and destroys each `BandTileData.texture`.
- **`ZarrLayer`**: no override; inherits the base behavior.

Composition rules:

- Library cleanup runs **after** the user's `onTileUnload`, so user code still
  observes live textures if it inspects them.
- Destroyers guard each field with `instanceof Texture` before calling
  `.destroy()`, so a same-named non-Texture field is never touched.
- luma.gl's `.destroy()` is idempotent, so composition is safe even if a user
  callback also frees the same texture.

The "library created the texture" condition for `COGLayer` is precisely
`!this.props.getTileData`: `_getTileDataCallback()` returns
`props.getTileData ?? state.defaultGetTileData`, so the default pipeline's textures
exist exactly when `props.getTileData` is absent. (A user who passes `getTileData`
but not `renderTile` still supplies the textures, so no cleanup — correct.)

## Helper

Library cleanup uses an **internal-only** helper (e.g. `destroyTileTextures`); it
is not added to any barrel export. Examples destroy their own textures with an
inline one-liner. This keeps the public API surface minimal — there is no external
helper to maintain or document.

## Examples

Covered by library cleanup with **zero edits**:

- `cog-basic`, `titiler-cog`, `cog-globe`, `globe-view` — stock `COGLayer`.
- `sentinel-2` — `MultiCOGLayer`.

Need their own `onTileUnload` (custom `getTileData`/`getn`, user-owned textures):

- COG: `usgs-topo-cutline`, `vermont-cog-comparison`, `naip-mosaic` (inner
  `COGLayer`), `land-cover` — destroy `tile.data.texture`. Shared colormap/filter
  textures are module-level and intentionally left alone.
- Zarr: `dynamical-zarr-ecmwf`, `aef-mosaic`, `nldas-icechunk` — destroy
  `tile.data.texture`.

To audit during implementation:

- `zarr-sentinel2-tci` returns `{ image }` (a CPU `ImageData`, GC-safe) rather than
  a `Texture`. Where its render texture is created and whether *that* leaks is a
  separate question; confirm before deciding whether it needs cleanup.

## Testing

- Unit-test each destroyer: destroys Texture-valued `texture`/`mask`; ignores
  absent or non-Texture fields; walks the bands map and destroys every band
  texture.
- Test `COGLayer` installs cleanup only when `getTileData` is absent, and composes
  the destroyer with a user-supplied `onTileUnload` (both run).
- Test `MultiCOGLayer` always installs cleanup.

## Out of scope

- No opt-out prop (e.g. `_destroyTileTextures: false`). Nothing currently relies on
  texture retention, and this is a `0.8` beta. An escape hatch can be added later
  if a concrete need for retaining a `tile.data.texture` appears.
- No public texture-cleanup helper export (see Helper).
