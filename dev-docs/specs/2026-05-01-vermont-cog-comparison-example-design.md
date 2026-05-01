# `vermont-cog-comparison` example

## Goal

Add a new example, `examples/vermont-cog-comparison`, that demonstrates side-by-side temporal comparison of [Vermont Open Data](https://registry.opendata.aws/vt-opendata/) statewide aerial imagery COGs using deck.gl's `_SplitterWidget`. Two map views, viewports synchronized, each with independent year selection and render-mode controls.

This is also the repo's first pure-deck.gl example (no maplibre), so it doubles as a reference for multi-view + splitter usage with `COGLayer`.

## Why

Vermont publishes ~50 years of statewide aerial imagery (1974-2025) as Cloud-Optimized GeoTIFFs in a CORS-enabled, unsigned-access S3 bucket. The split-view comparison surfaces dramatic temporal change (urban growth, deforestation, the 1970s-vs-today resolution jump) that no single-frame view can convey, and showcases that `COGLayer` can stream multi-hundred-GB rasters efficiently from cloud storage into the browser.

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

A single `App.tsx` rendering `<DeckGL>` in fully controlled mode:

- `views` — driven by `SplitterWidget.onChange` (initialized empty, populated on mount).
- `viewState` — `{ left: MapViewState, right: MapViewState }`. Both keys are kept identical (synchronized panning/zooming).
- `onViewStateChange({ viewState: vs })` — writes `vs` to BOTH `left` and `right`.
- `widgets` — `[new SplitterWidget({ viewLayout })]`.
- `viewLayout` — horizontal split, two `MapView` instances with `id: 'left'` and `id: 'right'`, both `controller: true`.
- `layerFilter` — restricts each layer to its target view by id suffix: `({ layer, viewport }) => layer.id.endsWith(viewport.id)`.
- `initialViewState` — Burlington waterfront: `{ longitude: -73.218, latitude: 44.476, zoom: 13 }`.

The widget is `_SplitterWidget` (underscore prefix — experimental in deck.gl 9.3+). Imported as `_SplitterWidget as SplitterWidget`.

### Layers

Per side (`'left' | 'right'`):

1. **Basemap layer** — `id: basemap-{side}`. `TileLayer` wrapping `BitmapLayer` over CARTO dark raster XYZ tiles: `https://basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png`. Same code on both sides; differs only in id.

2. **COG layer** — `id: cog-{side}`. `COGLayer` with:
   - `geotiff` = the URL of the side's currently selected file
   - `getTileData` — branches on `bands === 1` vs `bands ∈ {3, 4}`; see "Tile loaders" below
   - `renderTile` — selects pipeline based on `(bands, renderMode)`; see "Render pipelines" below

The two sides share zero render state — each holds its own `{ url, bands, renderMode }` tuple.

### Per-side state

```ts
type SideState = {
  fileIndex: number;          // index into VT_FILES
  renderMode: RenderMode;     // 'trueColor' | 'falseColor' | 'ndvi' | 'grayscale'
};

type AppState = {
  left: SideState;
  right: SideState;
  viewState: { left: MapViewState; right: MapViewState };
  views: View[];              // resolved by SplitterWidget
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

Each pane has a collapsible floating panel in its top corner:

- Left pane: top-left, `position: absolute; left: 12px; top: 12px`
- Right pane: top-right, `position: absolute; right: 12px; top: 12px`

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
├── package.json            # mirrors cog-basic; adds @deck.gl/widgets, @deck.gl/react
├── tsconfig.json
├── vite.config.ts
├── index.html
├── README.md
└── src/
    ├── main.tsx            # entry; createRoot + <App />
    ├── App.tsx             # everything described in Architecture
    ├── vt-imagery.ts       # VT_FILES table + types
    ├── shaders.ts          # SetAlpha1, setFalseColorInfrared, ndvi, ndviFilter
    │                       # (extracted from naip-mosaic/App.tsx for clarity)
    ├── tile-loaders.ts     # getTileDataRGBA, getTileDataGray
    ├── render-pipelines.ts # renderRGB, renderFalseColor, renderNDVI, renderGrayscale
    └── vite-env.d.ts
```

Splitting the helpers into their own files (vs all-in-`App.tsx` like naip-mosaic) keeps `App.tsx` focused on the multi-view + splitter wiring, which is the novel part of this example.

## Dependencies (package.json)

Same versions as `cog-basic`/`naip-mosaic`:

- `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/geo-layers`, `@deck.gl/widgets` (new), `@deck.gl/react` (new — replaces `@deck.gl/mapbox`)
- `@developmentseed/deck.gl-geotiff`, `@developmentseed/deck.gl-raster`, `@developmentseed/geotiff`
- `@luma.gl/core`, `@luma.gl/shadertools`
- `react`, `react-dom`
- `vite`, `@vitejs/plugin-react`, `gh-pages`

Drop: `maplibre-gl`, `react-map-gl`, `@deck.gl/mapbox`.

## Testing

- `pnpm typecheck` and `pnpm build` must pass.
- `pnpm dev` launches; default Burlington view shows 1994-2000 grayscale on the left, 2025 RGB on the right.
- Drag the splitter handle: ratio changes, both halves keep rendering.
- Pan/zoom one side: the other side stays in lockstep.
- Change file on either side: layer reloads, render-mode dropdown updates to the valid modes for that file's band count.
- Switch a 4-band side to NDVI: red-yellow-green colormap renders; vegetation visible.
- Mobile (375px viewport in devtools): both panels stay accessible (collapsible), splitter still draggable.

## Open follow-ups (not blocking)

- A "year scrubber" replacing the dropdowns. Out of scope for v1.
- Adding per-county/per-year files (~30 more entries). Out of scope for v1.
- A "lock to single side" toggle that hides the splitter and shows only one side full-width. Out of scope.
