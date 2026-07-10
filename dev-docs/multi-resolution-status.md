# Multi-Resolution Tileset — Current Status

## What Works

- **MultiTilesetDescriptor** (`deck.gl-raster`): Groups N tilesets at different resolutions, auto-selects finest as primary. Includes `selectSecondaryLevel` (with configurable strategy) and `tilesetLevelsEqual` for grid comparison.

- **Secondary Tile Resolver** (`deck.gl-raster`): Computes which secondary tiles cover a primary tile and the UV transform to align them.

- **CompositeBands GPU Module** (`deck.gl-raster`): Static shader module with 4 fixed band texture slots. Uses `channelMap` ivec4 to route bands to RGBA output. Works with the luma.gl uniform block pattern for scalars + inject pattern for textures (see `dev-docs/gpu-modules.md`).

- **LinearRescale GPU Module** (`deck.gl-raster`): Linear `[min, max] -> [0, 1]` rescaling. Required for displaying uint16 data like Sentinel-2 reflectance.

- **MultiCOGLayer** (`deck.gl-geotiff`): Opens multiple COGs in parallel, builds TilesetDescriptors, fetches tiles for all bands, creates GPU textures, and renders via CompositeBands + RasterLayer.

- **Same-resolution rendering**: True color composite (B04 + B03 + B02, all 10m) renders correctly with distinct RGB channels and proper rescaling.

- **fetchTiles + assembleTiles** (`geotiff`): Multi-tile fetch with proper typed-array-preserving stitching. Used by MultiCOGLayer for secondary tile assembly.

- **Sentinel-2 example app** (`examples/sentinel-2`): Visual demo with preset band composites.

## Known Issues

### 1. Multi-resolution alignment (20m bands misaligned)

**Status**: Not working correctly.

When mixing 10m and 20m bands (e.g., SWIR composite with B12 at 20m), the 20m band tiles don't align with the 10m primary grid. The UV transforms from `resolveSecondaryTiles` may be incorrect, or there's an issue in how the stitched secondary texture maps to the primary tile's mesh.

**Symptoms**: Visible tile-boundary artifacts — correct color in some tiles, wrong color (often solid blue or wrong hue) in others.

**To debug**: Log the UV transforms computed by `resolveSecondaryTiles` and verify they match the expected geographic sub-region. Compare the CRS extents of primary tiles with their corresponding secondary tile coverage.

### 2. Tile cache invalidation on preset switch

**Status**: Not working.

When switching between band composite presets, the `TileLayer` doesn't re-fetch tiles. Old cached tiles have band data for the previous preset, so `buildCompositeBandsProps` either crashes (band not found) or renders stale data. A guard returns `null` for stale tiles, but new data isn't fetched.

**Fix needed**: Use `updateTriggers` on `getTileData` or change the `TileLayer` id/data when sources change to force a full reload.

### 3. Texture format hardcoded

**Status**: Works for uint8 and uint16 single-band, but limited.

`createBandTexture` supports `r8unorm` (Uint8Array) and `r16unorm` (Uint16Array). Multi-band textures, float32, and other formats are not yet handled. Should eventually use `inferTextureFormat` from `texture.ts`.

### 4. enforceAlignment for uint16

**Status**: Works but may have edge cases.

The `enforceAlignment`/`padToAlignment` function pads rows to 4-byte alignment for WebGL's `UNPACK_ALIGNMENT`. This works for most tile sizes but the interaction with odd-width clipped edge tiles and `Uint16Array` needs more testing.

### 5. Band-separate layout not supported

`createBandTexture` throws for band-separate raster layouts. Only pixel-interleaved is supported.

## Architecture Decisions Made

### luma.gl Shader Module Binding Rules

Documented in `dev-docs/gpu-modules.md`. Key insight discovered during debugging:

- **Scalar uniforms** (float, vec4, ivec4): Must use `fs:` uniform block + `uniformTypes` + `getUniforms`
- **Texture bindings** (sampler2D): Must use `inject["fs:#decl"]` + `getUniforms` with matching key names
- Without `uniformTypes`, scalar uniforms silently default to 0

### Fixed Slot Design for CompositeBands

Dynamic uniform names (per-band) don't work with luma.gl's binding system. Instead, 4 fixed slots (`band0`–`band3`) with an `ivec4 channelMap` that routes slots to RGBA output. `buildCompositeBandsProps` maps semantic band names to slot indices.

## File Summary

| File | Status |
|------|--------|
| `packages/deck.gl-raster/src/multi-raster-tileset/` | Complete |
| `packages/deck.gl-raster/src/gpu-modules/composite-bands.ts` | Working (fixed slots) |
| `packages/deck.gl-raster/src/gpu-modules/linear-rescale.ts` | Working |
| `packages/deck.gl-raster/src/gpu-modules/types.ts` | Updated (wider prop types) |
| `packages/deck.gl-geotiff/src/multi-cog-layer.ts` | Working for same-res, needs multi-res debugging |
| `packages/geotiff/src/assemble.ts` | Complete |
| `packages/geotiff/src/fetch.ts` | Complete (fetchTiles added) |
| `examples/sentinel-2/` | Working demo |
| `dev-docs/gpu-modules.md` | Reference doc for shader module patterns |
| `dev-docs/specs/2026-04-09-multi-resolution-tileset-design.md` | Design spec |
| `dev-docs/plans/2026-04-09-multi-resolution-tileset.md` | Implementation plan (partially executed) |
