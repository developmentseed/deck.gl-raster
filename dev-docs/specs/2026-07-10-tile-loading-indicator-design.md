# Tile Loading Indicator for Examples

- **Date:** 2026-07-10
- **Issues:** [#599](https://github.com/developmentseed/deck.gl-raster/issues/599)
- **Status:** Approved

## Problem

The example apps give no visual feedback while tiles are fetching. A user
panning or zooming, or switching data sources, sees stale or blank tiles with no
indication that work is in progress. Issue #599 asks for a spinner UI element
that shows when tiles are loading.

## Goals

- A reusable loading indicator, centralized in `examples/_shared`, so the visual
  is defined once.
- Wiring that stays **visible in each example** — a reader learning from the
  examples should be able to see exactly how loading state is derived from
  deck.gl callbacks, not have it hidden by magic in a shared wrapper.
- Demonstrate the pattern across the main layer types without editing all ~13
  example apps.

## Non-Goals

- No changes to library packages (`deck.gl-raster`, `deck.gl-geotiff`,
  `deck.gl-zarr`). Every layer already forwards the deck.gl `TileLayer`
  callbacks this design relies on.
- Not wiring every example — three representative apps only (see Scope).
- No per-tile progress bar or percentage; a binary loading/idle indicator only.

## Background: the available signal

Every example layer (`COGLayer`, `MosaicLayer`, `ZarrLayer`) extends
`RasterTileLayer`, which forwards the standard deck.gl `TileLayer` callbacks,
including `onViewportLoad` — fired when every tile selected for the current
viewport has resolved ("done").

deck.gl provides **no matching "load started" event**. `Deck`'s `onAfterRender`
hook exposes only `{ device, gl }`, not the layers, so polling `layer.isLoaded`
per frame is not available through the public `MapboxOverlay` API.

The "started" edge must therefore be derived from what the example already knows:

- The **map moving** (`onMoveStart` on the MapLibre map) — panning/zooming
  selects new tiles.
- A **new load being kicked off** by the app — e.g. the user switching data
  source.

Resetting to "done" is authoritative via the layer's `onViewportLoad`.

## Design

### Component 1 — `LoadingIndicator` (presentational)

`examples/_shared/components/loading-indicator.tsx`

```tsx
<LoadingIndicator loading={boolean} label?="Loading tiles…" />
```

- Renders nothing when `loading` is false.
- When true: a rounded pill at top-center containing a Chakra `Spinner` and the
  `label` text (default `"Loading tiles…"`).
- Contains **no logic** — purely `loading` in, pill out.
- Positioned inside the existing pointer-events-none
  [`UIOverlay`](../../examples/_shared/components/ui-overlay.tsx) so it floats
  above the map without blocking interaction. Absolute box, `top`, centered
  horizontally via `left="50%"` + `transform`.
- Exported from `examples/_shared/index.ts` alongside the other shared
  components.

### Component 2 — `useTilesLoading` (state hook)

`examples/_shared/hooks/use-tiles-loading.ts`

```ts
const { loading, onViewportLoad, onLoadingStart } = useTilesLoading();
```

Returns:

- `loading: boolean` — pass to `<LoadingIndicator>`.
- `onViewportLoad: () => void` — attach to the tile layer's `onViewportLoad`
  prop. Sets `loading` false. This is the "done" edge.
- `onLoadingStart: () => void` — call when a new load begins (map `onMoveStart`,
  or a source-switch handler). Sets `loading` true. This is the "started" edge.

Internals (~15 lines): `useState(true)` — initialized true so the very first
tile fetch shows the indicator before any move happens. `onLoadingStart` → set
true; `onViewportLoad` → set false. Both callbacks are stabilized with
`useCallback` so they are safe to pass as layer/map props.

The hook's docstring documents the non-obvious point: deck.gl has no native
"load started" event, so callers supply that edge via `onLoadingStart`
(typically the map's `onMoveStart`).

### How an example wires it

```tsx
const { loading, onViewportLoad, onLoadingStart } = useTilesLoading();

const cogLayer = new COGLayer({ /* … */, onViewportLoad });

return (
  <div style={{ position: "relative", width: "100%", height: "100%" }}>
    <MaplibreMap onMoveStart={onLoadingStart} …>
      <DeckGlOverlay layers={[cogLayer]} interleaved />
    </MaplibreMap>

    <UIOverlay>
      <LoadingIndicator loading={loading} />
    </UIOverlay>
    {/* existing ControlPanel … */}
  </div>
);
```

The two deck.gl/map touch-points — `onViewportLoad` on the layer, `onMoveStart`
on the map — are visible in the example itself. The shared hook only removes the
copy-pasted `useState` boilerplate; the mechanism a reader needs to understand
stays in the example file.

## Scope: examples to wire

Three representative apps, one per primary layer type:

1. **`cog-basic`** — `COGLayer` (single COG). Source-switch via the existing
   dropdown already triggers `fitBounds` → a map move, so `onMoveStart` covers
   it; no extra source-change wiring needed.
2. **`naip-mosaic`** — `MosaicLayer`. Note this app already has a separate
   `loading` state for the STAC index fetch, shown in its `ControlPanel`. The
   new tile-loading indicator is distinct (named `tilesLoading` locally) and
   nicely illustrates metadata-loading vs. tile-loading as two concerns.
3. **`zarr-sentinel2-tci`** — `ZarrLayer`. The layer is created conditionally
   (`zarrLayer ? [zarrLayer] : []`); `onViewportLoad` attaches to the layer when
   present.

Other examples can adopt the pattern later by copying these ~3 visible lines.

## Error handling

- `onViewportLoad` fires once the viewport's tiles have settled; a transient
  tile fetch error does not leave the spinner hung indefinitely because
  subsequent moves re-trigger `onLoadingStart`/`onViewportLoad`. Per-tile error
  handling (`onTileError`) is out of scope for this indicator.

## Testing / verification

Examples in this repo are not unit-tested; verification is manual per the repo's
example workflow:

- `pnpm typecheck` passes for the shared package and the three wired examples.
- `pnpm biome check` clean.
- Manual: run each wired example, confirm the pill appears on initial load and
  on pan/zoom into new tiles, and disappears when tiles finish.

## Files

- **New:** `examples/_shared/components/loading-indicator.tsx`
- **New:** `examples/_shared/hooks/use-tiles-loading.ts`
- **Edit:** `examples/_shared/index.ts` (export both)
- **Edit:** `examples/cog-basic/src/App.tsx`
- **Edit:** `examples/naip-mosaic/src/App.tsx`
- **Edit:** `examples/zarr-sentinel2-tci/src/App.tsx`
