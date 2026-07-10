# Multi-Resolution Tileset Design

## Problem

Satellites like Sentinel-2 have bands at different spatial resolutions (10m, 20m, 60m). When rendering a scene that combines bands from different resolution groups (e.g., NDVI from a 10m red band and a 20m NIR band), the internal tiling grids don't _necessarily_ align across resolutions. The tile pyramids have different tile sizes, grid dimensions, and overview structures.

The GPU naturally handles resolution differences — if two textures represent the same geographic area but one has 2x the pixels, the GPU's bilinear sampler interpolates correctly. The hard part is aligning the tile grids so that each texture covers the correct geographic region.

## Goals

- Render multiple bands from different resolution groups in a single shader pass
- Tile traversal driven by the highest-resolution tileset
- No CPU resampling — GPU handles interpolation via texture sampling
- Resolution alignment (UV transforms, stitching) is invisible to shader/module authors
- Support both separate COGs per band and Zarr multiscales convention
- Start with COG implementation (`MultiCOGLayer`), extract common abstractions later

## Non-Goals (Deferred)

- Arbitrary overlapping rasters with different CRS/extent (only same-scene, same-extent sources)
- Shader module pipeline evolution for >4 channel inter-module data flow
- Tile caching optimization (future work)
- Coalesced tile fetching a la `fetchTiles` (future optimization, orthogonal to this design)

## Design

### 1. MultiTilesetDescriptor

A new type in `deck.gl-raster` that groups N tilesets representing the same geographic extent at different native resolutions.

```ts
interface MultiTilesetDescriptor {
  /** Highest resolution tileset — drives tile traversal */
  primary: TilesetDescriptor;

  /** Lower-resolution tilesets, keyed by user-defined name */
  secondaries: Map<string, TilesetDescriptor>;

  /** Shared CRS bounds (all tilesets must match within tolerance) */
  bounds: [minX: number, minY: number, maxX: number, maxY: number];

  /** Shared projection functions */
  projectTo3857: (x: number, y: number) => [number, number];
  projectTo4326: (x: number, y: number) => [number, number];
}
```

**Primary selection**: The tileset with the finest `metersPerPixel` at its highest-resolution level is the primary. This can be auto-detected or user-specified.

**Constraint**: All tilesets must share the same CRS and geographic extent. Enforced at construction time.

**Tile traversal**: Unchanged. Only `primary.levels` are used by `getTileIndices()` and `RasterTileNode`. Secondaries are never traversed independently.

**Short-circuit**: When multiple sources share the same tile grid (e.g., all 10m Sentinel-2 bands), they can share a single `TilesetDescriptor` entry. The layer detects grid equality and avoids redundant UV transform computation.

### 2. Tile Fetch & Stitch

When a primary tile `(x, y, z)` is selected for rendering:

#### Step 1: Compute primary tile extent

From the primary tileset level's affine transform, compute the CRS bounding box of the tile.

#### Step 2: Select secondary level

For each secondary tileset, pick the level whose `metersPerPixel` is the closest finer-than-or-equal-to the primary tile's level. If the secondary's finest level is still coarser than the primary (e.g., 60m band at 10m zoom), use the finest available — this is physically correct (the band simply has lower resolution).

#### Step 3: Find covering secondary tiles

Use the selected secondary level's `crsBoundsToTileRange(primaryBounds)` to get the set of secondary tile indices that overlap the primary tile's extent. Typically 1 tile, occasionally 2-4 at grid boundaries.

#### Step 4: Fetch secondary tiles

Fetch all covering secondary tiles as raw pixel buffers at their native resolution.

#### Step 5: Stitch

If multiple secondary tiles cover the primary extent, stitch them into a single contiguous pixel buffer. This is a memcpy operation — no resampling. The stitched buffer covers the bounding box of all fetched secondary tiles (which is >= the primary tile's extent).

#### Step 6: Compute UV transform

The stitched texture covers a slightly larger geographic area than the primary tile. Compute a UV transform that maps from the primary tile's UV space `[0,1]²` to the correct sub-region of the stitched texture:

```
uvScale.x = primaryExtent.width / stitchedExtent.width
uvScale.y = primaryExtent.height / stitchedExtent.height
uvOffset.x = (primaryExtent.minX - stitchedExtent.minX) / stitchedExtent.width
uvOffset.y = (primaryExtent.minY - stitchedExtent.minY) / stitchedExtent.height
```

The shader samples with: `sampledUV = uv * uvScale + uvOffset`

#### Fetch return type

```ts
interface MultiTileData {
  /** Primary source texture — UV transform is identity */
  primary: {
    texture: Texture;
    uvTransform: [0, 0, 1, 1]; // [offsetX, offsetY, scaleX, scaleY]
  };

  /** One entry per secondary source */
  secondaries: Record<string, {
    texture: Texture;
    uvTransform: [number, number, number, number];
  }>;
}
```

### 3. MultiCOGLayer

A new layer in `deck.gl-geotiff` that orchestrates multi-resolution rendering.

#### User API

```ts
new MultiCOGLayer({
  sources: {
    red:  { url: "B04.tif" },   // 10m
    nir:  { url: "B08.tif" },   // 10m — same grid as red
    swir: { url: "B11.tif" },   // 20m — different grid
  },

  // Option A: built-in band reduction for common cases
  // (mutually exclusive with fragmentShader)
  composite: { r: "nir", g: "swir", b: "red" },

  // Option B: custom fragment shader for complex cases
  // (mutually exclusive with composite)
  fragmentShader: `
    uniform sampler2D bandRed;
    uniform sampler2D bandNir;
    uniform vec4 uvTransform_red;
    uniform vec4 uvTransform_nir;

    vec2 applyUvTransform(vec2 uv, vec4 transform) {
      return uv * transform.zw + transform.xy;
    }

    void main() {
      float red = texture(bandRed, applyUvTransform(vTexCoord, uvTransform_red)).r;
      float nir = texture(bandNir, applyUvTransform(vTexCoord, uvTransform_nir)).r;
      float ndvi = (nir - red) / (nir + red);
      fragColor = vec4(ndvi, ndvi, ndvi, 1.0);
    }
  `,

  // Standard render pipeline modules still work for post-processing
  // (colormap, nodata filtering, etc.) on the vec4 output
  renderPipeline: [Colormap({ ... })],
})
```

#### Initialization

1. Open all source COGs in parallel
2. Build a `TilesetDescriptor` from each (reusing existing COG metadata parsing)
3. Detect grid equality across sources — group sources that share the same tile grid
4. Construct `MultiTilesetDescriptor` with the finest-resolution tileset as primary
5. Set up `RasterTileset2D` using the primary tileset for traversal

#### getTileData(tileIndex)

1. Fetch primary tile data (existing COG tile fetch logic)
2. For each secondary group:
    1. Compute primary tile CRS extent
    1. Select appropriate secondary level
    1. Find covering secondary tiles via `crsBoundsToTileRange`
    1. Fetch covering tiles
    1. Stitch if needed (memcpy)
    1. Compute UV transform
3. Return `MultiTileData` bundle

Sources that share the primary's tile grid are fetched with identity UV transforms (the short-circuit optimization).

#### renderTile(tileData)

1. Upload all textures to GPU
2. Bind UV transforms as uniforms
3. Create mesh from primary tileset (existing `RasterReprojector`)
4. If using built-in composite: inject a `CompositeBands` GPU module that samples named bands, applies UV transforms, and outputs a `vec4` color
5. If using custom fragment shader: pass it through with texture/transform uniforms
6. Append any `renderPipeline` modules for post-processing
7. Render via `MeshTextureLayer`

### 4. Shader Integration

#### UV Transform Injection

A utility GLSL function provided to all shaders:

```glsl
vec2 applyBandUvTransform(vec2 uv, vec4 transform) {
  return uv * transform.zw + transform.xy;
}
```

Where `transform = vec4(offsetX, offsetY, scaleX, scaleY)`.

#### Built-in CompositeBands Module

A new GPU module that handles the common case of combining 1-4 bands into an RGB(A) output:

```ts
CompositeBands({
  r: "red",   // semantic band name → texture uniform
  g: "nir",
  b: "swir",
  // optional: a: "alpha"
})
```

This module:
- Declares `sampler2D` and `vec4 uvTransform` uniforms for each referenced band
- Samples each band with the UV transform applied
- Outputs a `vec4 color` into the pipeline
- Downstream modules (colormap, nodata, etc.) work on this `vec4` as today

#### Custom Shader Escape Hatch

For complex band math (spectral indices, classification), users write a custom fragment shader that directly samples named band textures. The layer provides:
- `sampler2D band_<name>` uniforms for each source
- `vec4 uvTransform_<name>` uniforms
- The `applyBandUvTransform` utility function

The custom shader outputs a `vec4 fragColor` which can then be post-processed by standard render pipeline modules.

### 5. Data Flow Summary

```
User Config
  ├── sources: { red: B04.tif (10m), nir: B08.tif (10m), swir: B11.tif (20m) }
  └── composite: { r: "red", g: "swir", b: "nir" }
          │
          ▼
MultiCOGLayer.init()
  ├── Opens all COGs
  ├── Builds TilesetDescriptor per source
  ├── Groups by grid equality: { 10m: [red, nir], 20m: [swir] }
  └── Constructs MultiTilesetDescriptor (primary = 10m grid)
          │
          ▼
Tile Traversal (primary grid only)
  └── Selected tile (x=3, y=7, z=2)
          │
          ▼
getTileData(3, 7, 2)
  ├── Fetch red tile (3,7,2) from 10m grid → texture, uvTransform=[0,0,1,1]
  ├── Fetch nir tile (3,7,2) from 10m grid → texture, uvTransform=[0,0,1,1]
  │   (same grid as primary — short circuit)
  └── Fetch swir:
      ├── Primary tile CRS extent → [600100, 7990200, 602700, 7992800]
      ├── Secondary level selection → 20m level
      ├── crsBoundsToTileRange → covers secondary tile (1, 3)
      ├── Fetch secondary tile (1, 3) → texture
      └── Compute uvTransform → [0.02, 0.05, 0.48, 0.48]
          │
          ▼
renderTile(multiTileData)
  ├── Upload textures: bandRed, bandNir, bandSwir
  ├── Upload uniforms: uvTransform_red, uvTransform_nir, uvTransform_swir
  ├── Generate mesh from primary tile (RasterReprojector)
  ├── CompositeBands module: sample each band with UV transform → vec4
  ├── Downstream pipeline: colormap, nodata, etc.
  └── MeshTextureLayer.draw()
```

## Future Considerations

- **Coalesced fetching**: When multiple primary tiles need overlapping secondary tiles, dedup fetches. Orthogonal to this design — can be added to the fetch layer later.
- **Zarr support**: The `MultiTilesetDescriptor` is format-agnostic. A future `MultiZarrLayer` would parse the Zarr multiscales convention to construct it, using `transform.scale` and `derived_from` fields.
- **RasterTileLayer abstraction**: When `RasterTileLayer` is extracted into `deck.gl-raster`, `MultiCOGLayer` should become a thin wrapper that provides sources and a `getTileData` implementation.
- **>4 band pipeline**: The current design limits inter-module data flow to `vec4`. Supporting richer data flow between modules (structs, multiple named channels) is a separate evolution of the GPU module system.
- **Tile caching**: Secondary tile fetches may be shared across primary tiles. A cache keyed by (source, level, tileX, tileY) would reduce redundant fetches.
