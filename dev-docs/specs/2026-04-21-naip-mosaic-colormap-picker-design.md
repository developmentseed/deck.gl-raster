---
title: NAIP mosaic — colormap picker for NDVI mode
date: 2026-04-21
status: approved
---

# NAIP mosaic — colormap picker for NDVI mode

## Motivation

The `naip-mosaic` example currently renders NDVI with a hard-coded `cfastie`
colormap loaded from a bundled `Uint8ClampedArray` in
`examples/naip-mosaic/src/cfastie.ts`. The `dynamical-zarr-ecmwf` example has
since demonstrated the sprite-based colormap API
(`decodeColormapSprite` + `createColormapTexture` + `COLORMAP_INDEX`), which
lets the user choose from any of the shipped colormaps without bundling custom
color data per-example.

This spec brings that same picker pattern to `naip-mosaic`. The picker only
appears in NDVI render mode, because true-color and false-color-infrared modes
don't sample through a colormap.

## Scope

In scope:

- Replace the hand-built `device.createTexture(...)` + `cfastie` upload with
  `decodeColormapSprite` + `createColormapTexture` (loading
  `@developmentseed/deck.gl-raster/gpu-modules/colormaps.png`).
- Delete `examples/naip-mosaic/src/cfastie.ts`.
- Add a colormap `<select>` dropdown + preview strip to the control panel,
  visible only when `renderMode === "ndvi"`.
- Pass `colormapIndex` (and `reversed: false`) to the `Colormap` shader module
  in `renderNDVI`.
- Keep `cfastie` as the default so existing visual behavior is preserved.

Out of scope:

- Adding a "reversed" checkbox to the UI. None of the shortlist needs
  reversing; hard-code `reversed: false` at the call site to keep the UI
  focused.
- Extracting a reusable colormap-picker component. The dynamical example has
  its own, and factoring into a shared package is a separate effort.
- Changing non-NDVI rendering paths.

## Design

### Colormap shortlist

A small, NDVI-appropriate list. Order drives dropdown order:

| id         | label                           | sprite index                |
| ---------- | ------------------------------- | --------------------------- |
| `cfastie`  | cfastie (default NDVI)          | `COLORMAP_INDEX.cfastie`    |
| `rdylgn`   | RdYlGn (red → yellow → green)   | `COLORMAP_INDEX.rdylgn`     |
| `greens`   | greens (sequential)             | `COLORMAP_INDEX.greens`     |
| `ylgn`     | YlGn (yellow → green)           | `COLORMAP_INDEX.ylgn`       |
| `viridis`  | viridis (perceptually uniform)  | `COLORMAP_INDEX.viridis`    |
| `spectral` | spectral (diverging)            | `COLORMAP_INDEX.spectral`   |

All entries use `reversed: false`.

Default on first load: `cfastie` (matches current behavior).

### File layout

A new file, `examples/naip-mosaic/src/colormap-choices.ts`, mirroring the
shape used in `dynamical-zarr-ecmwf/src/ecmwf/colormap-choices.ts`. It
exports:

- `COLORMAP_CHOICES` — `readonly` tuple of `{ id, label, colormapIndex, reversed }`
- `ColormapId` — union of literal `id` strings
- `DEFAULT_COLORMAP_ID` — `"cfastie"`

`examples/naip-mosaic/src/cfastie.ts` is deleted, along with its import in
`App.tsx`.

### Sprite loading

Mirror the dynamical example's two-step loader in `App.tsx`:

1. On mount, `fetch(colormapsPngUrl)` → `decodeColormapSprite(bytes)` →
   store `ImageData` in state. No GPU device required.
2. When both the device (from `onDeviceInitialized`) and the `ImageData` are
   ready, call `createColormapTexture(device, image)` and store the resulting
   texture in state.

This replaces the existing `useEffect` that builds the texture from
`colormap.data`.

### Shader wiring

`renderNDVI` currently calls:

```ts
{ module: Colormap, props: { colormapTexture } }
```

It will change to accept the currently-selected choice and pass both index
and reversed flag:

```ts
{
  module: Colormap,
  props: {
    colormapTexture,
    colormapIndex: choice.colormapIndex,
    reversed: choice.reversed,
  },
}
```

Because `renderNDVI` is called from a `renderTile` callback constructed each
render, no memoization changes are required — deck.gl's prop diff handles
the rest.

### UI changes

Inside the existing panel in `App.tsx`, the `renderMode === "ndvi"` block
gains two elements above the existing NDVI-range slider:

1. A labeled `<select>` bound to `colormapId` state.
2. A small preview strip rendered from `colormapsPngUrl` using the same
   `backgroundImage` / `backgroundPosition` trick as the dynamical example's
   control panel. This keeps behavior consistent across examples.

The colormap picker is not shown in `trueColor` or `falseColor` modes, so
the DOM stays uncluttered when the colormap isn't used.

### State

One new piece of React state in `App`:

```ts
const [colormapId, setColormapId] = useState<ColormapId>(DEFAULT_COLORMAP_ID);
```

The currently-selected choice is derived via `COLORMAP_CHOICES.find(...)` at
render time (same pattern as the dynamical example).

## Testing

This is an examples-only change with no unit tests. Verification is manual:

1. Run the NAIP mosaic example locally (`pnpm --filter naip-mosaic dev`).
2. Confirm default NDVI view matches current cfastie rendering.
3. Switch between all six colormaps; preview strip matches rendered tiles.
4. Switch to True Color and False Color — picker is hidden; rendering
   unchanged.
5. Switch back to NDVI — selection persists, no flicker.

## Risks / open questions

- **Sprite download timing.** The sprite is small (<100 KB) and fetched once,
  but if it loads after NDVI tiles start rendering, the texture won't be
  ready. The existing `stacItems.length > 0 && colormapTexture` gate in the
  layer construction covers this — we just need to keep that guard.
- **Preview-strip styling.** Copied verbatim from the dynamical example.
  If the panel width differs, the preview height may need minor tweaking,
  but functionally it works at any width.
