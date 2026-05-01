# `vermont-cog-comparison` example

## Goal

Add a new example, `examples/vermont-cog-comparison`, that demonstrates a classic "swipe map" comparison of [Vermont Open Data](https://registry.opendata.aws/vt-opendata/) statewide aerial imagery COGs. A single map; a draggable vertical handle reveals different years on the left vs. right; the geography under any given screen pixel stays fixed as the handle moves. Each side has independent year and render-mode controls.

This is also the repo's first pure-deck.gl example (no maplibre), so it doubles as a reference for swipe-map UX over `COGLayer`.

## Why

Vermont publishes ~50 years of statewide aerial imagery (1974-2025) as Cloud-Optimized GeoTIFFs in a CORS-enabled, unsigned-access S3 bucket. The swipe comparison surfaces dramatic temporal change (urban growth, deforestation, the 1970s-vs-today resolution jump) that no single-frame view can convey, and showcases that `COGLayer` can stream multi-hundred-GB rasters efficiently from cloud storage into the browser.

A naive "two MapView panes" approach (e.g. deck.gl's `_SplitterWidget`) fails the comparison criterion — each pane's projection re-centers in its own width, so the same geographic point lands at different screen pixels on either side of the splitter, and the imagery slides as the handle moves. The swipe pattern (one shared viewport, layers clipped at a screen-space line) is what map comparison tools like `mapbox-gl-compare` use, and it's what users intuitively expect.

## Non-goals

- Browsing the bucket dynamically. The file list is hardcoded to the curated set below.
- Yearly per-county imagery (only the `STATEWIDE_*` composites).
- A separate mobile-first redesign. Standard collapsible panels are expected to work on mobile, but no mobile-only layout work.
- Additional render modes beyond grayscale, true color, false color IR, NDVI.
- User-adjustable NDVI range or colormap.

## Source data

Files live at `https://vtopendata-prd.s3.amazonaws.com/Imagery/<filename>`. CORS is open (`Access-Control-Allow-Origin: *`, methods `HEAD, GET`).

| Year(s)   | Filename                                          | Bands | GSD   |
| --------- | ------------------------------------------------- | ----- | ----- |
| 1974-1992 | `STATEWIDE_1974-1992_100cm_LeafOFF_1Band.tif`     | 1     | 100cm |
| 1994-2000 | `STATEWIDE_1994-2000_50cm_LeafOFF_1Band.tif`      | 1     | 50cm  |
| 2006-2010 | `STATEWIDE_2006-2010_50cm_LeafOFF_1Band.tif`      | 1     | 50cm  |
| 2011-2015 | `STATEWIDE_2011-2015_50cm_LeafOFF_4Band.tif`      | 4     | 50cm  |
| 2021      | `STATEWIDE_2021_60cm_LeafON_4Band.tif`            | 4     | 60cm  |
| 2021-2022 | `STATEWIDE_2021-2022_30cm_LeafOFF_4Band.tif`      | 4     | 30cm  |
| 2023      | `STATEWIDE_2023_30cm_LeafON_4Band.tif`            | 4     | 30cm  |
| 2024      | `STATEWIDE_2024_30cm_LeafOFF_4Band.tif`           | 4     | 30cm  |
| 2025      | `STATEWIDE_2025_30cm_LeafON_3Band.tif`            | 3     | 30cm  |

Defaults: left = 1994-2000 (1-band grayscale), right = 2025 (3-band RGB).

## Architecture

### Top-level component

A single `App.tsx` rendering `<DeckGL>` with one `MapView` and one shared `viewState`. The canvas is always full size; nothing about the canvas or view changes when the swipe handle moves — only a per-layer clip rectangle.

- `viewState` — single `MapViewState` for the whole canvas; pan/zoom updates it normally via `onViewStateChange`.
- `views` — single `MapView({ id: 'map', controller: true })` (no splitter widget, no per-side views).
- `splitFraction` — number in `[0, 1]`, the horizontal position of the swipe handle as a fraction of canvas width. Held in `useRef` and mirrored to a state update via `requestAnimationFrame` so dragging stays at frame rate.
- `initialViewState` — Burlington waterfront: `{ longitude: -73.218, latitude: 44.476, zoom: 13 }`.
- `initialSplitFraction` — `0.5`.

### Swipe handle

A small custom React component (`SwipeHandle`) mounted as an overlay on top of the DeckGL canvas:

- Renders a 1-2px vertical white/translucent line spanning the full canvas height, plus a centered grabber dot.
- Captures `pointerdown` on the handle, then attaches `pointermove` and `pointerup` listeners to `window`.
- On move: `nextFraction = (event.clientX - canvasLeft) / canvasWidth`, clamped to `[0.05, 0.95]`. Stored in a ref; one rAF schedules the next state flush.
- Position itself via inline style: `left: calc(${splitFraction * 100}% - 1px)`.

No deck.gl widget involvement.

### Layer clipping (`ClipExtension`)

Both COG layers cover the entire viewport. Each receives `extensions: [new ClipExtension()]` and a `clipBounds: [west, south, east, north]` in **Web Mercator [0, 1] coordinates** (the format `ClipExtension` requires for geo layers).

`clipBounds` for each side is recomputed whenever the viewport OR `splitFraction` changes:

```ts
// Pseudocode in App.tsx, computed inside useMemo([viewState, splitFraction]).
const splitX = canvasWidth * splitFraction;
// viewport.unproject is provided by the live WebMercatorViewport.
const [splitLng] = viewport.unproject([splitX, 0]);
const splitMercatorX = lngToMercatorX(splitLng);
// Mercator y bounds span the full visible vertical extent (0 .. 1 is fine).
const leftClip:  [number, number, number, number] = [0, 0, splitMercatorX, 1];
const rightClip: [number, number, number, number] = [splitMercatorX, 0, 1, 1];
```

The basemap layer is **not** clipped — both halves share it.

`viewport` is obtained from `<DeckGL>`'s `onViewStateChange` callback (`viewports[0]` on the resolved deck) or from a `useRef` populated in `onAfterRender`. Either way, `clipBounds` updates on every `viewState` change as well as every `splitFraction` change, keeping the swipe line locked to a fixed screen-x position as the user pans.

### Layers

- **Basemap** — `id: basemap`. Single `TileLayer` wrapping `BitmapLayer` over CARTO dark raster XYZ tiles: `https://basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png`. Renders edge-to-edge under both COGs. No clip.

- **Left COG** — `id: cog-left`. `COGLayer` with the left side's selected file, its tile loader and render pipeline (see below), and `extensions: [new ClipExtension()]`, `clipBounds: leftClip`.

- **Right COG** — `id: cog-right`. Same shape as left, with `clipBounds: rightClip`.

The two COG layers share zero state — each holds its own `{ url, bands, renderMode }` tuple. Both fetch tiles for the full viewport (over-fetch acceptable: each "wasted" tile becomes useful prefetch the moment the user drags the swipe handle past it).

### Per-side state

```ts
type SideState = {
  fileIndex: number;          // index into VT_FILES
  renderMode: RenderMode;     // 'trueColor' | 'falseColor' | 'ndvi' | 'grayscale'
};

type AppState = {
  left: SideState;
  right: SideState;
  viewState: MapViewState;    // single shared viewport
  splitFraction: number;      // 0..1, swipe-handle horizontal position
  device: Device | null;      // for colormap texture upload
};
```

The set of valid `renderMode` values for each side is derived from the selected file's `bands`:

- 1 band → `['grayscale']`
- 3 bands → `['trueColor']`
- 4 bands → `['trueColor', 'falseColor', 'ndvi']`

When the user picks a new file whose band count doesn't support the current render mode, fall back to the first valid mode for that file.

### Tile loaders

Two variants, picked on the fly:

```ts
// 3 or 4 bands → existing naip-mosaic pattern
async function getTileDataRGBA(image, options) { /* rgba8unorm */ }

// 1 band → r8unorm
async function getTileDataGray(image, options) { /* r8unorm */ }
```

Both return `{ texture, width, height }`. The `App` chooses which to pass to `COGLayer.getTileData` based on `bands`.

### Render pipelines

Reused as-is from `examples/naip-mosaic/src/App.tsx`:

- `renderRGB(tileData)` — `[CreateTexture, SetAlpha1]`. Used for 3-band trueColor and 4-band trueColor.
- `renderFalseColor(tileData)` — `[CreateTexture, setFalseColorInfrared, SetAlpha1]`. Used for 4-band falseColor.
- `renderNDVI(tileData, opts)` — `[CreateTexture, ndvi, ndviFilter, Colormap, SetAlpha1]`. Used for 4-band NDVI. Fixed: colormap = `RdYlGn`, `ndviRange = [-1, 1]`.

Plus one new pipeline:

- `renderGrayscale(tileData)` — `[CreateTexture(r8unorm), BlackIsZero, SetAlpha1]`. Uses the existing `BlackIsZero` GPU module (just broadcasts `color.r` into G and B).

NDVI requires a `colormapTexture`; mount a `useEffect` that fetches `colormaps.png`, decodes it, and uploads to GPU once `device` is available — same pattern as `naip-mosaic`.

### UI: per-side control panels

Each side has a collapsible floating panel anchored in its top corner of the canvas. (The panels do not move with the swipe handle — they remain in the canvas corners regardless of `splitFraction`.)

- Left side: top-left, `position: absolute; left: 12px; top: 12px`
- Right side: top-right, `position: absolute; right: 12px; top: 12px`

Each panel contains:

- A title bar with a chevron toggle (collapse/expand), matching `cog-basic` and `naip-mosaic`.
- A `<select>` for the file (year + GSD label, e.g. "2025 (30cm, 3-band)").
- A `<select>` for the render mode (only modes valid for that file's band count).
- An attribution / "Source: Vermont Open Data" line.

Width ~260px on desktop. On narrow viewports the panels stay in their corners, are collapsible, and don't overflow because `max-width: calc(50vw - 24px)`.

A single shared bottom strip contains the deck.gl-raster docs link and an overall attribution, so the per-side panels can stay focused.

## Files

```
examples/vermont-cog-comparison/
├── package.json            # mirrors cog-basic; adds @deck.gl/extensions, @deck.gl/react
├── tsconfig.json
├── vite.config.ts
├── index.html
├── README.md
└── src/
    ├── main.tsx            # entry; createRoot + <App />
    ├── App.tsx             # everything described in Architecture
    ├── swipe-handle.tsx    # SwipeHandle React component
    ├── vt-imagery.ts       # VT_FILES table + types
    ├── shaders.ts          # SetAlpha1, setFalseColorInfrared, ndvi, ndviFilter
    │                       # (extracted from naip-mosaic/App.tsx for clarity)
    ├── tile-loaders.ts     # getTileDataRGBA, getTileDataGray
    ├── render-pipelines.ts # renderRGB, renderFalseColor, renderNDVI, renderGrayscale
    └── vite-env.d.ts
```

Splitting the helpers into their own files (vs all-in-`App.tsx` like naip-mosaic) keeps `App.tsx` focused on the swipe wiring (`ClipExtension` + handle), which is the novel part of this example.

## Dependencies (package.json)

Same versions as `cog-basic`/`naip-mosaic`:

- `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/geo-layers`, `@deck.gl/extensions` (new — for `ClipExtension`), `@deck.gl/react` (new — replaces `@deck.gl/mapbox`)
- `@developmentseed/deck.gl-geotiff`, `@developmentseed/deck.gl-raster`, `@developmentseed/geotiff`
- `@luma.gl/core`, `@luma.gl/shadertools`
- `proj4`, `react`, `react-dom`
- `vite`, `@vitejs/plugin-react`, `gh-pages`

Drop: `maplibre-gl`, `react-map-gl`, `@deck.gl/mapbox`, `@deck.gl/widgets`.

## Testing

- `pnpm typecheck` and `pnpm build` must pass.
- `pnpm dev` launches; default Burlington view shows 1994-2000 grayscale on the left half, 2025 RGB on the right half, swipe handle vertically centered.
- Drag the swipe handle: the dividing line moves left/right. The geography under the cursor (a building, a road) stays fixed; only which year's imagery covers it changes.
- Pan/zoom: the swipe handle stays anchored at the same screen-x position; both COGs stay aligned to the basemap.
- Change file on either side: layer reloads, render-mode dropdown updates to the valid modes for that file's band count.
- Switch a 4-band side to NDVI: red-yellow-green colormap renders; vegetation visible.
- Mobile (375px viewport in devtools): both control panels stay accessible (collapsible), swipe handle still draggable via touch.

## Open follow-ups (not blocking)

- A "year scrubber" replacing the dropdowns. Out of scope for v1.
- Adding per-county/per-year files (~30 more entries). Out of scope for v1.
- Tile-fetch culling per side via `extent` recomputed from `splitFraction`, debounced — reduces 2× over-fetch. Out of scope for v1.
- A "lock to single side" toggle that hides the swipe handle and shows only one COG full-width. Out of scope.
