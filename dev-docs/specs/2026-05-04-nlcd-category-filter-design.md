---
title: NLCD category filter — design
date: 2026-05-04
status: approved
---

# NLCD category filter

## Goal

Add a category-filter UI to the land-cover example that lets the user
check/uncheck NLCD land-cover categories. Pixels belonging to unchecked
categories are discarded on the GPU. Bundles a switch from `r8unorm` to
`r8uint` upload for the example, since NLCD codes are categorical and a
0–1 normalization is semantically wrong for them.

The filter logic is shipped as a small set of GPU shader modules local to
the example. Nothing in `@developmentseed/deck.gl-raster` or
`@developmentseed/deck.gl-geotiff` changes — the example overrides the
inferred render pipeline via the `COGLayer`'s `getTileData` and
`renderTile` props.

## Non-goals

- No changes to `inferTextureFormat` or `inferRenderPipeline`. The
  default pipeline for unsigned-integer rasters stays `r8unorm`.
- No new exports from `@developmentseed/deck.gl-raster`. Modules are
  example-local. If they prove generally useful, promotion to the
  package is a follow-up.
- No support for category codes beyond uint8 (0–255). NLCD's max code is
  95.
- No changes to the existing `Colormap`, `FilterNoDataVal`, or
  `CreateTexture` modules.

## Architecture

### Render pipeline

Three shader modules, all local to the example:

```
[CreateTextureUint] → [FilterCategory] → [PaletteColormap]
```

#### Inter-module bus convention: `ivec4 icolor`

The framework macro signature is unchanged
(`DECKGL_FILTER_COLOR(color, geometry)`). Modules in this pipeline pass
integer pixel data through a function-local `ivec4 icolor` declared by
the producer module and consumed by the rest. luma.gl concatenates all
`fs:DECKGL_FILTER_COLOR` injections into one function body, so the
declaration is in scope for every subsequent injection.

This is a documented convention, not a framework feature. The producer
must come before consumers in the pipeline (same constraint that
already governs `color`-writers like `Colormap`). If consumers run
without a producer, the GLSL compiler reports `icolor` as undeclared
and the layer fails to compile.

A separate, future effort can wrap this convention in a typed
TypeScript abstraction that compiles into luma.gl shader modules and
verifies producer/consumer pairings at TS compile time. That is out of
scope here.

#### `CreateTextureUint`

Replaces the default `CreateTexture` (which is `r8unorm`-only).
Declares the source as an integer sampler and introduces the `icolor`
bus.

```glsl
// fs:#decl
uniform highp usampler2D textureName;

// fs:DECKGL_FILTER_COLOR
ivec4 icolor = ivec4(texture(textureName, geometry.uv));
```

This module does not touch `color`. Subsequent modules in the pipeline
are responsible for writing `color` before `DECKGL_FILTER_COLOR`
returns.

#### `FilterCategory`

Looks up the user's selection in a 256-byte LUT texture. Discards if
the category is not selected.

```glsl
// fs:#decl
uniform sampler2D categoryFilterLUT;

// fs:DECKGL_FILTER_COLOR
if (texelFetch(categoryFilterLUT, ivec2(icolor.r, 0), 0).r < 0.5) {
  discard;
}
```

Prop: `categoryFilterLUT: Texture` (256×1, `r8unorm`, value `255` for
selected codes, `0` for unselected). Reads `icolor.r`. Must come after a
module that introduces `ivec4 icolor`.

#### `PaletteColormap`

Maps the integer category code to a final RGBA color via integer
indexing into a 256×1 RGBA colormap texture. Replaces the existing
unorm `Colormap` module *for this pipeline only*.

```glsl
// fs:#decl
uniform sampler2D colormapTexture;

// fs:DECKGL_FILTER_COLOR
color = texelFetch(colormapTexture, ivec2(icolor.r, 0), 0);
```

Prop: `colormapTexture: Texture` (256×1, `rgba8unorm`). Reads
`icolor.r`, writes `color`. Must come after a module that introduces
`ivec4 icolor`.

The colormap is built once at COG load time from the GeoTIFF's embedded
`ColorMap` tag, using the existing
[`parseColormap`](packages/geotiff/src/colormap.ts) helper from
`@developmentseed/geotiff`. `parseColormap` already zeroes alpha at the
nodata index when given the nodata value, so nodata pixels render as
transparent without an explicit shader filter.

### Texture upload

A custom `getTileData` mirrors the default pipeline's behavior with one
change: forces `format: 'r8uint'` instead of inferring `r8unorm`. Tile
fetching, mask handling, and reprojection mesh data stay identical.

The `r8uint` format is already in the FORMAT_TABLE in
[packages/deck.gl-geotiff/src/geotiff/texture.ts](packages/deck.gl-geotiff/src/geotiff/texture.ts) —
we just need to ask for it explicitly.

### Selection state

Lives in `App.tsx` as React state:

```ts
const [selected, setSelected] = useState<Set<number>>(
  new Set(ALL_NLCD_CODES),
);
```

- Initialized to *all* category codes (everything visible by default).
- A `useMemo` derives a `Uint8Array(256)` LUT (`255` at each selected
  code, `0` elsewhere).
- The LUT bytes are written into a 256×1 `r8unorm` texture. The texture
  itself is created once and updated in place via `setSubImageData`
  when the selection changes — no allocation churn.
- The texture is passed through `renderTile` so it ends up as the
  `categoryFilterLUT` prop on the `FilterCategory` module.

### UI

Replace the current read-only `Legend` with a checkbox version, keeping
the existing nested structure (heading → leaf categories):

- One checkbox per **leaf category** (16 total).
- One checkbox per **heading** (8 total). Toggling a heading
  selects/deselects all of its leaves. The heading checkbox is shown as
  indeterminate when its leaves are mixed.
- The category swatch + label + description from the existing legend is
  preserved per leaf.

Component file: `examples/land-cover/src/components/CategoryFilter.tsx`.
The existing `Legend.tsx` is replaced.

## File layout

All under `examples/land-cover/src/`:

```
gpu-modules/
  create-texture-uint.ts    # CreateTextureUint module
  filter-category.ts        # FilterCategory module
  palette-colormap.ts       # PaletteColormap module
  index.ts                  # barrel
nlcd/
  categories.ts             # NLCD category list (codes, headings, colors, descriptions)
  build-colormap-texture.ts # parseColormap (alpha=0 at nodata) → 256x1 rgba8unorm Texture
  build-filter-texture.ts   # selection Set → 256x1 r8unorm LUT (create + in-place update)
get-tile-data.ts            # custom COGLayer getTileData (forces r8uint)
render-tile.ts              # custom COGLayer renderTile (wires the three modules)
components/
  CategoryFilter.tsx        # checkboxes (replaces Legend.tsx)
  InfoPanel.tsx             # updated to render CategoryFilter
```

The current `Legend.tsx` is removed; the embedded `LEGEND_DATA` moves
into `nlcd/categories.ts` so the filter UI and the colormap-texture
builder share a single source of truth.

## Data flow

```
COG load:
  GeoTIFF ColorMap tag + nodata value
    → build-colormap-texture
    → 256×1 rgba8unorm Texture (alpha=0 at nodata index)
    → stored in App state, passed into renderTile

User toggles a checkbox:
  selected: Set<number>
    → build-filter-texture (Uint8Array(256))
    → 256×1 r8unorm Texture (in-place update)
    → stored in App state, passed into renderTile

Per tile render:
  CreateTextureUint samples the r8uint tile texture → introduces ivec4 icolor
  FilterCategory texelFetches the LUT at icolor.r → discards if 0
  PaletteColormap texelFetches the colormap at icolor.r → writes final RGBA into color
```

## Testing

The example is a runtime-only demo (no unit tests in
`examples/land-cover` today). Verification happens in the browser:

- Load the existing NLCD COG; confirm visual output matches the current
  `r8unorm` pipeline (colors per the GeoTIFF's embedded ColorMap).
- Toggle each leaf checkbox; confirm only the matching pixels disappear.
- Toggle a heading checkbox; confirm all leaves under it toggle
  together, and the heading shows indeterminate state when mixed.
- Confirm nodata pixels remain invisible at all times.
- Confirm zooming, panning, and the existing debug overlay still work.

If the underlying `inferRenderPipeline` and other examples were
previously passing, this change should not affect them — the only
contact point is the example overriding `getTileData`/`renderTile`.

## Open follow-ups (out of scope here)

- **Typed shader-module abstraction.** A TS-level API that lets module
  authors declare `reads`/`writes` of typed inter-module buses and
  compiles down to luma.gl shader modules, with TS-compile-time
  verification of pipeline composition. This would supersede the
  `ivec4 icolor` convention used here with a checked, self-documenting
  alternative. Needs its own brainstorm + spec.
- Promotion of `CreateTextureUint`, `FilterCategory`, and
  `PaletteColormap` into `@developmentseed/deck.gl-raster` if other
  examples or downstream consumers want them.
- Migration of `inferRenderPipeline` to use `r8uint` + the integer
  modules for Palette photometric COGs by default.
- Categorical filtering for uint16/uint32 rasters (would need a larger
  LUT or a different mechanism).
