# Colormap `reversed` Prop

## Goal

Add an optional `reversed` boolean to the `Colormap` GPU module. When true, the colormap texture is sampled at `1.0 - color.r` instead of `color.r`, matching matplotlib's `_r` suffix convention (e.g. `viridis_r`).

## Scope

Single file: [packages/deck.gl-raster/src/gpu-modules/colormap.ts](../../../packages/deck.gl-raster/src/gpu-modules/colormap.ts). Plus a new test file.

## Design

### Props

```ts
export type ColormapProps = {
  colormapTexture: Texture;
  /** When true, samples the colormap in reverse (matches matplotlib's `_r` suffix). */
  reversed?: boolean;
};
```

`reversed` is optional. Default is `false` so existing callers (geotiff render-pipeline, naip-mosaic example) are unaffected.

### Shader

Add a uniform block exposing a `float reversed` (0.0 / 1.0). This follows the UBO pattern already used in `linear-rescale.ts` and `filter-nodata.ts`.

luma.gl v9.3's `uniformTypes` has no `"bool"` option — a boolean must be declared as `"f32"`, `"i32"`, or `"u32"` (see `UniformLeafType` in `@luma.gl/shadertools/dist/lib/utils/uniform-types.d.ts`). `f32` is the simplest of the three because it plugs directly into GLSL `mix()` without a cast; `i32`/`u32` would require `mix(..., float(colormap.reversed))`.

```glsl
uniform colormapUniforms {
  float reversed;
} colormap;
```

GLSL in `DECKGL_FILTER_COLOR`:

```glsl
float idx = mix(color.r, 1.0 - color.r, colormap.reversed);
color = texture(colormapTexture, vec2(idx, 0.));
```

`mix` is branchless and correct for both endpoints: `mix(a, b, 0.0) == a`, `mix(a, b, 1.0) == b`.

### `getUniforms`

```ts
getUniforms: (props: Partial<ColormapProps>) => ({
  colormapTexture: props.colormapTexture,
  reversed: props.reversed ? 1.0 : 0.0,
})
```

## Tests

New file `packages/deck.gl-raster/tests/gpu-modules/colormap.test.ts`, matching the pattern in `composite-bands.test.ts`:

- The `fs` uniform block declares `reversed`.
- `inject["fs:#decl"]` declares the `colormapTexture` sampler.
- `inject["fs:DECKGL_FILTER_COLOR"]` contains the `mix(...)` expression and the `texture(colormapTexture, ...)` call.
- `uniformTypes.reversed === "f32"`.
- `getUniforms({ reversed: true }).reversed === 1.0`.
- `getUniforms({ reversed: false }).reversed === 0.0`.
- `getUniforms({}).reversed === 0.0` (default).
- `colormapTexture` is passed through unchanged.

## Non-goals

- No changes to callers. `reversed` is optional.
- No matplotlib-style `_r` name lookup in the colormap generation script — callers opt in via the prop.
