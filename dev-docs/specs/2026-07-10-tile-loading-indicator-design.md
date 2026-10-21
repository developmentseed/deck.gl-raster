# Tile Loading Indicator for Examples

- **Date:** 2026-07-10 (revised 2026-09-23)
- **Issues:** [#599](https://github.com/developmentseed/deck.gl-raster/issues/599)
- **Status:** Draft — revised design, pending review

## Problem

The example apps give no visual feedback while tiles are fetching. A user
panning or zooming, or switching data sources, sees stale or blank tiles with no
indication that work is in progress. Issue #599 asks for a spinner that shows
when tiles are loading. A later PR comment points at `aef-mosaic`, whose first
view takes a long time to render with no feedback.

## Why the first design was replaced

The first version of this PR added a `useTilesLoading` hook. The map's
`onMoveStart` turned loading on and the layer's `onViewportLoad` turned it off.
That fails in three ways:

1. **The spinner can get stuck on.** `TileLayer` only fires `onViewportLoad`
   when the tileset's frame number changes, and `Tileset2D.update()` only bumps
   the frame number when some tile's visibility changes. A small pan or zoom
   that keeps the same tiles on screen turns loading on via `onMoveStart`, and
   `onViewportLoad` never fires to turn it off.
2. **`naip-mosaic` clears too early.** `MosaicLayer`'s `onViewportLoad` comes
   from its inner `TileLayer`, whose "tiles" are the GeoTIFF sources. It fires
   once the headers are open, not once each source's `COGLayer` has loaded its
   image tiles.
3. **Loads that don't come from moving the map are missed.** In `aef-mosaic`,
   changing the year changes the layer `id`, which reloads every tile without
   firing `movestart`.

All three come from rebuilding a loading state out of two separate events,
one of which (the start) deck.gl doesn't provide.

## Background: deck.gl's loading signal

- **`layer.isLoaded` covers every level of nesting.** `CompositeLayer.isLoaded`
  is true only when all of its sublayers are loaded. `TileLayer.isLoaded` is
  true only when every selected tile has loaded *and* every sublayer drawn for
  those tiles is loaded. So `MosaicLayer.isLoaded` already covers both levels:
  the GeoTIFF sources in view, and each source's image tiles.
- **deck.gl 9.4 ships a `LoadingWidget`** in `@deck.gl/widgets`. On every
  redraw its `onRedraw({ layers })` receives every layer deck has applied,
  sublayers included, and sets `loading = layers.some((l) => !l.isLoaded)`. It
  draws a spinner button while loading, and it starts out in the loading state.
- **Why a widget and not React state.** Every React render creates new layer
  instances. deck applies them on its next animation frame
  (`LayerManager._nextLayers`), and until then a new instance's `isLoaded` is
  `false`. Code that reads `isLoaded` from the layers React holds, for example
  in `onAfterRender`, can see those unapplied instances and flip back and forth.
  A widget only ever receives layers deck has already applied.
- **Works with our map setup.** In interleaved mode, `MapboxOverlay` passes its
  props through to `Deck`, so `widgets` works like any other `Deck` prop.

## Goals

- Use deck.gl's built-in `LoadingWidget` instead of our own loading logic.
- Theme it to match the examples' Chakra `ControlPanel`.
- The spinner never stays on after loading finishes.
- It covers the nested mosaic and loads not caused by moving the map (source
  or year switches).
- Adopting it in an example takes three imports (the widget, its stylesheet
  and the shared props) and one `widgets` prop.

## Non-Goals

- **No library changes in this PR.** The `RasterTileLayer.isLoaded` fix (see
  Dependency) lands as its own PR.
- **No upstream deck.gl changes.**
- **No text label or top-centre placement.** `LoadingWidget` is an icon-only
  button, and widgets can only go in the corners.
- **Examples without `DeckGlOverlay`.** `globe-view` and `titiler-cog` don't
  render deck layers through the shared overlay, so they're out of scope.

## Dependency: `RasterTileLayer.isLoaded` fix ([#667](https://github.com/developmentseed/deck.gl-raster/pull/667), merged)

`COGLayer`, `ZarrLayer` and `MultiCOGLayer` fetch metadata asynchronously in
`updateState` and render no sublayers until it arrives. A composite layer with
no sublayers counts as loaded, so they report `isLoaded === true` while the
COG header or Zarr metadata is still being fetched, and the spinner hides
during that fetch.

#667 makes these layers report "not loaded" while their metadata is loading,
and "loaded" if it failed, so an error can't leave the spinner showing. It adds
a protected `_isLoadingMetadata()` hook to `RasterTileLayer`, which `COGLayer`,
`MultiCOGLayer` and `ZarrLayer` override. This branch picks it up by merging
`main`.

## Design

### Shared widget props — `examples/_shared/styles/loading-widget.ts`

One exported constant holds the placement, label and theme, so every example
gets the same widget:

```ts
import type { DeckWidgetTheme, LoadingWidgetProps } from "@deck.gl/widgets";

/** Theme values matching the shared Chakra `ControlPanel`. */
const theme: DeckWidgetTheme = {
  "--widget-margin": "20px", // ControlPanel's corner offset
  "--button-size": "36px",
  "--button-background": "#fff",
  "--button-corner-radius": "8px", // Chakra `lg`
  "--button-shadow": "0 2px 8px rgba(0, 0, 0, 0.1)", // ControlPanel's shadow
  "--button-icon-idle": "#52525b", // Chakra `gray.600`
};

/** Props for deck.gl's `LoadingWidget`, themed to match the examples. */
export const loadingWidgetProps: LoadingWidgetProps = {
  placement: "top-right", // ControlPanel takes top-left
  label: "Loading tiles…",
  style: theme as Partial<CSSStyleDeclaration>,
};
```

- **Theme through `style`.** deck's `applyStyles` passes `--*` keys to
  `style.setProperty`, and the widget stylesheet reads its colours and sizes
  from those variables. `WidgetProps.style` is typed as
  `Partial<CSSStyleDeclaration>`, so the theme needs one cast.
- **`top-right`** isn't used by any example. `ControlPanel` defaults to
  `top-left`, and no example adds MapLibre controls.
- Exported from `examples/_shared/index.ts`.

### How an example wires it

```tsx
import { LoadingWidget } from "@deck.gl/widgets";
import "@deck.gl/widgets/stylesheet.css";
import { DeckGlOverlay, loadingWidgetProps } from "deck.gl-raster-examples-shared";

<DeckGlOverlay
  layers={layers}
  widgets={[new LoadingWidget(loadingWidgetProps)]}
  interleaved
/>
```

- **The stylesheet is imported in each example**, the same way each example
  already imports `maplibre-gl/dist/maplibre-gl.css`.
- **Creating the widget on every render is safe.** `WidgetManager` matches
  widgets by `id`, keeps the existing instance (and its loading state), and
  updates its props.
- `DeckGlOverlay` needs no changes, because it already passes all
  `MapboxOverlayProps` through.

### Behaviour

- **First load:** the widget starts in the loading state, so the spinner shows
  immediately.
- **No layers yet:** in interleaved mode deck doesn't redraw when there are no
  layers, so the widget keeps its initial loading state. That's correct while
  the app fetches its own metadata before creating a layer (`aef-mosaic`,
  `zarr-sentinel2-tci`, and `naip-mosaic`'s STAC query).
- **Pan or zoom:** the layer update selects new tiles and deck redraws, so the
  spinner shows until they load. If no new tiles are needed, the redraw sees
  everything loaded and the spinner stays hidden.
- **Source or year switch:** handled the same way; nothing specific to
  switching is needed.
- **Mosaic:** covered by the nested `isLoaded` checks described above.

### What gets removed

- `examples/_shared/components/loading-indicator.tsx` and its exports.
- `examples/_shared/hooks/use-tiles-loading.ts` and its exports (the `hooks/`
  directory goes away).
- The `onMoveStart` and `onViewportLoad` wiring and the `<LoadingIndicator>`
  elements in the three examples that have them.

## Scope: examples to wire

Every example that renders through `DeckGlOverlay`, so they all behave the same.
Four of them exercise a specific case:

1. **`cog-basic`** — `COGLayer`, with a dropdown to switch COGs.
2. **`naip-mosaic`** — `MosaicLayer` wrapping one `COGLayer` per source. This
   app has an `error` state for its STAC query. When it's set there are no
   layers, so the widget would keep spinning; pass `widgets={[]}` in that case.
3. **`zarr-sentinel2-tci`** — `ZarrLayer`.
4. **`aef-mosaic`** — `ZarrLayer`; the example the PR comment asked about.
   Covers the year switch (new layer `id`).

The rest take the plain `widgets` prop:
- `COGLayer`: `cog-globe` (globe view), `land-cover`, `usgs-topo-cutline` and
  `vermont-cog-comparison`.
- `MultiCOGLayer`: `sentinel-2`.
- `ZarrLayer`: `dynamical-zarr-ecmwf` and `nldas-icechunk`.

## Dependencies

Add `"@deck.gl/widgets": "^9.4.0"` to `examples/_shared` (for the types) and to
every wired example (for `LoadingWidget` and the stylesheet). It pulls in
`preact` and `@floating-ui/dom`.

## Testing / verification

- **No new unit tests.** The loading logic is deck.gl's, and the example apps
  aren't unit-tested.
- `pnpm typecheck` and `pnpm biome check` pass.
- **Manual check** (dev server, you look at it). In each wired example:
  - The spinner shows on first load and clears once imagery appears.
  - After a small pan that needs no new tiles, the spinner doesn't show, or
    clears.
  - After a pan or zoom into new tiles, it shows and then clears.
- **Also check:**
  - `cog-basic`: switching COG shows the spinner until the new COG renders.
  - `naip-mosaic`: the spinner stays until the NAIP imagery is visible, not
    just until the headers load.
  - `aef-mosaic`: changing the year shows the spinner.

## Files

- **New:** `examples/_shared/styles/loading-widget.ts`
- **Delete:** `examples/_shared/components/loading-indicator.tsx`
- **Delete:** `examples/_shared/hooks/use-tiles-loading.ts`
- **Edit:** `examples/_shared/index.ts` (drop the old exports, add
  `loadingWidgetProps`)
- **Edit:** `examples/_shared/package.json`
- **Edit:** `package.json` and `src/App.tsx` in each wired example (all eleven
  listed under Scope)
- **Edit:** `pnpm-lock.yaml`
