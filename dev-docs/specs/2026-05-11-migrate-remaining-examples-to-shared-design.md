---
title: Migrate remaining examples to deck.gl-raster-examples-shared — design
date: 2026-05-11
status: approved
---

# Migrate remaining examples to `deck.gl-raster-examples-shared`

## Goal

Execute roadmap item #1 from
[`2026-05-11-shared-example-components-design.md`](./2026-05-11-shared-example-components-design.md):
migrate the seven examples not covered by PR
[#520](https://github.com/developmentseed/deck.gl-raster/pull/520) —
`aef-mosaic`, `dynamical-zarr-ecmwf`, `land-cover`, `naip-mosaic`,
`usgs-topo-cutline`, `vermont-cog-comparison`, `zarr-sentinel2-tci` — onto the
`deck.gl-raster-examples-shared` workspace package, following the `cog-basic` /
`sentinel-2` pilot pattern. As part of this, add the three shared components
from the original spec's roadmap that serve **two or more** examples
(`RangeSlider`, `HelpTooltip`, `ColormapPreview`).

Per the original spec, changing each example's visual appearance to the shared
Chakra look is in scope — the goal is one consistent panel style across all nine
examples, not preservation of each example's bespoke inline-styled UI.

## Non-goals

- **Not adding single-use widgets to `_shared`.** `land-cover`'s `CategoryFilter`
  (nested indeterminate checkbox tree) and `vermont-cog-comparison`'s
  `SwipeHandle` (draggable split divider) stay as local components in their one
  example each. (Roadmap items #4 and #5 — revisit if a second consumer appears.)
- **No shared build scaffolding.** Per-example `vite.config.ts` and `index.html`
  stay as they are (original spec's non-goal).
- **No changes to published packages.** `_shared` gains no new external
  dependency in this work — `RangeSlider` / `HelpTooltip` build on Chakra +
  collecticons (already deps); `ColormapPreview` is prop-driven so `_shared`
  stays decoupled from `@developmentseed/deck.gl-raster`.
- **No unit tests for the new `_shared` components.** Same rationale as v1:
  thin presentational/glue layer, examples themselves untested.
- **Not touching example logic** (tile loaders, render-tile pipelines, GPU
  shader modules, projection setup, STAC fetching, animation loops). Only the
  React UI shell — `main.tsx`, `App.tsx`, `src/ui/`, `src/components/` — changes.

## New `_shared` components

Three new named exports from `_shared/index.ts`, plus one backward-compatible
prop added to `DebugControls`. Each takes a single props object and carries
JSDoc on the component and its props interface, per the existing `_shared`
conventions (Biome 2-space / double quotes / `useImportType` / `useBlockStatements`).

### `RangeSlider` — `components/range-slider.tsx`

A dual-thumb slider: a thin wrapper over Chakra v3's `Slider.Root` with two
thumbs (Chakra v3 sliders are multi-thumb natively), `colorPalette="brand"`,
`width="full"`. Renders only the control — examples wrap it in a `<Field>` whose
label carries the current-value text, exactly as `DebugControls` does for its
opacity slider.

```ts
interface RangeSliderProps {
  /** Lower bound of the track. */
  min: number;
  /** Upper bound of the track. */
  max: number;
  /** Step granularity. Default `1`. */
  step?: number;
  /** Current `[low, high]` value. */
  value: [number, number];
  /** Called with the next `[low, high]` value on any change. */
  onChange: (value: [number, number]) => void;
  /** Accessible labels for the two thumbs. Default `["Minimum", "Maximum"]`. */
  thumbLabels?: [string, string];
  /** Minimum steps the two thumbs must stay apart. Default `1`. */
  minStepsBetweenThumbs?: number;
}
```

Consolidates the four raw `@radix-ui/react-slider` `Slider.Root` usages —
`aef-mosaic` (rescale range), `dynamical-zarr-ecmwf` (rescale range + filter
range), `naip-mosaic` (NDVI range) — and lets all three examples drop the
`@radix-ui/react-slider` dependency.

Single-thumb sliders (`aef-mosaic` band selectors, `dynamical-zarr-ecmwf`
lead-time and frame-duration, `land-cover` mesh-max-error) are not covered by
this component — examples use Chakra's `Slider.Root` directly, the same
composition `DebugControls` already uses.

### `HelpTooltip` — `components/help-tooltip.tsx`

A small "?" trigger button (`CollecticonCircleQuestion` from
`@devseed-ui/collecticons-chakra`, already a `_shared` dep) that reveals tooltip
text on hover/focus, built on Chakra v3's `Tooltip`. Replaces `aef-mosaic`'s and
`dynamical-zarr-ecmwf`'s local `InfoTooltip` and `land-cover`'s `HelpIcon`.

```ts
interface HelpTooltipProps {
  /** Tooltip body content. */
  children: ReactNode;
  /** Accessible label for the trigger button. Default `"More information"`. */
  label?: string;
}
```

### `ColormapPreview` — `components/colormap-preview.tsx`

The colormap-sprite preview strip used byte-identically by `naip-mosaic` and
`dynamical-zarr-ecmwf`: a Chakra `Box` with the sprite PNG as `backgroundImage`,
`backgroundSize: 100% <rowCount * height>px`, `backgroundPosition` selecting the
row by index, `imageRendering: "pixelated"`, and `transform: scaleX(-1)` when
reversed. Sprite metadata comes in as props, so `_shared` doesn't depend on
`@developmentseed/deck.gl-raster` — the example passes `colormapsPngUrl`
(`import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png"`)
and `Object.keys(COLORMAP_INDEX).length`.

```ts
interface ColormapPreviewProps {
  /** URL of the colormap sprite PNG (one colormap per 1px row). */
  spriteUrl: string;
  /** Total number of rows in the sprite. */
  rowCount: number;
  /** Zero-based row index of the colormap to display. */
  rowIndex: number;
  /** Whether to mirror the strip horizontally. Default `false`. */
  reversed?: boolean;
  /** Human-readable colormap name, for the strip's `aria-label`. */
  label: string;
  /** Displayed strip height in px (the 1px row is stretched). Default `14`. */
  height?: number;
}
```

### `DebugControls` — add optional `label`

`DebugControlsProps` gains `label?: string` (default `"Debug overlay"`) so
`zarr-sentinel2-tci` keeps its accurate "Debug mesh" wording. Backward-compatible
with the two pilots, which don't pass it.

### Barrel & deps

`_shared/index.ts` adds: `RangeSlider` + `RangeSliderProps`, `HelpTooltip` +
`HelpTooltipProps`, `ColormapPreview` + `ColormapPreviewProps`.
`_shared/package.json` gains no new dependency.

## Per-example migration

Common to all seven (the `cog-basic` / `sentinel-2` pattern):

- `main.tsx`: wrap `<App/>` in `<ExampleProvider>` (imported from the shared package).
- `App.tsx`: delete the local `DeckGLOverlay` snippet → import `DeckGlOverlay`
  from `_shared`.
- The hand-rolled floating `<div>` (or `src/ui/control-panel.tsx` /
  `src/components/InfoPanel.tsx`) → `<ControlPanel title="…" sourcePath="examples/<name>">`,
  which supplies the collapsible header, the white card, and the
  docs/source/repo/Development-Seed footer.
- Native `<select>` / `<input type="checkbox">` / `<input type="range">` → Chakra
  `NativeSelect` / `Checkbox` / `Slider`, each wrapped in a `<Field label="…">`.
- External links → `<ExternalLink href="…">`. The standalone
  "deck.gl-raster Documentation ↗" line is removed (now in the `ControlPanel`
  footer).
- `package.json`: add `"deck.gl-raster-examples-shared": "workspace:*"`,
  `"@chakra-ui/react"`, `"@emotion/react"`; remove `"@radix-ui/react-slider"`
  where it was only used for the dual-thumb slider.
- Examples whose panel is currently inline in `App.tsx` keep it inline (like
  `cog-basic`); examples with a dedicated `src/ui/control-panel.tsx` keep that
  file (it stays substantial after migration).

Example-specific notes:

### `usgs-topo-cutline` (simplest)

`ControlPanel` containing intro prose, `Field`/`NativeSelect` (topo map choice),
`Field`/`Checkbox` (enable cutline). No specialized widgets. No radix.

### `zarr-sentinel2-tci`

`ControlPanel` containing GeoZarr intro prose, then
`<DebugControls label="Debug mesh" value={…} onChange={…}/>` for the mesh-debug
toggle + opacity slider (`DebugState` here is `{ debug, debugOpacity }`, no
`debugLevel`). No radix.

### `naip-mosaic`

Panel currently inline in `App.tsx` (≈760-line file) — stays inline.
`ControlPanel`; STAC / Planetary Computer / NAIP dataset prose links →
`ExternalLink`; `Field`/`NativeSelect` for render mode and (when `renderMode ===
"ndvi"`) colormap; `<ColormapPreview spriteUrl={colormapsPngUrl}
rowCount={Object.keys(COLORMAP_INDEX).length} rowIndex={choice.colormapIndex}
reversed={choice.reversed} label={choice.label}/>`; `<RangeSlider min={-1}
max={1} step={0.01} …/>` for the NDVI range, in a `<Field>` whose label shows
`-1 … +1` end markers and the live `min – max` value. Drop `@radix-ui/react-slider`.

### `vermont-cog-comparison`

`ComparePanel` (currently inline in `App.tsx`) → `ControlPanel`; per-side
`SideControls` year + render-mode `<select>`s → `Field`/`NativeSelect` (keeping
the `<optgroup>` grouping); `HeaderSubtitle` links → `ExternalLink`. **Keep**
`src/swipe-handle.tsx` as a local component — it's a positioned `Box` with
pointer-drag handlers and no form controls, so Chakra primitives add nothing;
restyle its line/grabber colors to match the shared theme if it reads as
mismatched. No radix.

### `aef-mosaic`

Keep `src/ui/control-panel.tsx` (still substantial). `ControlPanel`; location +
year `<select>` → `Field`/`NativeSelect`; the three `BandSlider` single-thumb
`<input type="range">`s → `Field` + Chakra `Slider.Root` (single thumb), label
showing `<channel> band: <bandLabel>`; rescale dual-thumb → `RangeSlider` in a
`<Field>` with the live `min – max` value; the rescale-info `InfoTooltip` →
`<HelpTooltip label="Rescale range info">…</HelpTooltip>`; the
"AlphaEarth Foundations GeoZarr Mosaic" attribution → `ExternalLink`. **Delete**
the local `InfoTooltip`. Drop `@radix-ui/react-slider`.

### `dynamical-zarr-ecmwf` (heaviest)

Keep `src/ui/control-panel.tsx` (≈600 lines). `ControlPanel`; the
"Forecast date" `<input type="date">` stays a native input (no Chakra date
picker) inside a `<Field label="Forecast date">`; the lead-time and
frame-duration `<input type="range">`s → `Field` + Chakra `Slider.Root` (single
thumb); the play/pause `<button>` keeps a Chakra `IconButton` but swaps the
local `PlayIcon`/`PauseIcon` SVGs for `CollecticonCirclePlay` /
`CollecticonCirclePause`; **delete** the local `PlayIcon` / `PauseIcon` /
`InfoTooltip`; colormap `<select>` → `Field`/`NativeSelect` + `ColormapPreview`;
the two dual-thumb rescale + filter sliders → two `RangeSlider`s, each in a
`<Field>` with the live `min°C – max°C` value; the lead-time-resolution
`InfoTooltip` → `<HelpTooltip label="Lead time resolution info">…</HelpTooltip>`;
the dynamical.org / ECMWF attribution links → `ExternalLink`. Drop
`@radix-ui/react-slider`.

### `land-cover`

`main.tsx`: wrap in `<ExampleProvider>`. `App.tsx`: replace the local
`UIOverlay` with the shared `UIOverlay`, local `DeckGLOverlay` with shared
`DeckGlOverlay`. `InfoPanel.tsx` → built on `ControlPanel`: intro prose; the
debug-overlay `<input type="checkbox">` + opacity `<input type="range">` →
`<DebugControls value={…} onChange={…}/>` (`DebugState` = `{ debug, debugOpacity }`);
the mesh-max-error `<input type="range">` → `Field` + Chakra `Slider.Root`;
`<CategoryFilter/>` stays a child component; the "Classification Reference" link
→ `ExternalLink`. `HelpIcon.tsx` → **deleted**, callsites use `HelpTooltip`.
`components/UIOverlay.tsx` → **deleted** (shared version used).
`components/CategoryFilter.tsx` → **kept**, but its raw `<input type="checkbox">`
nodes (master/group/leaf, including the master's indeterminate state) become
Chakra `Checkbox.Root` (which supports `checked="indeterminate"`), and the leaf
color swatches become small Chakra `Box`es — for visual consistency with the
rest of the themed panel. `InfoPanel.tsx` stays a component file (it's large
enough to warrant one).

## Data flow & error handling

Unchanged from the original spec. `_shared` holds no application state. The new
components are presentational: `RangeSlider` and `ColormapPreview` are fully
controlled; `HelpTooltip` owns only its ephemeral open flag. Bad props surface
as TypeScript errors; no runtime validation, no error boundaries.

## Delivery

One branch / PR — `kyle/shared-components-all` (already checked out). Staged
commits, with a review pause after each (per the repo's between-stages review
practice):

1. `feat(examples): add shared RangeSlider, HelpTooltip, ColormapPreview`
   (+ `DebugControls` `label` prop) — new components, barrel exports, no example
   changes. `pnpm -r typecheck` clean.
2. Migrate `usgs-topo-cutline` (smallest — first end-to-end exercise of the
   pattern on a fresh example).
3. Migrate `zarr-sentinel2-tci`.
4. Migrate `naip-mosaic` (first `RangeSlider` + `ColormapPreview` consumer;
   drops `@radix-ui/react-slider`).
5. Migrate `vermont-cog-comparison` (keeps `SwipeHandle` local).
6. Migrate `aef-mosaic` (first `HelpTooltip` consumer; drops
   `@radix-ui/react-slider`).
7. Migrate `dynamical-zarr-ecmwf` (heaviest; drops `@radix-ui/react-slider`).
8. Migrate `land-cover` (keeps `CategoryFilter` local).
9. `docs(examples)`: refresh `examples/README.md` if needed; tick roadmap
   item #1 in `2026-05-11-shared-example-components-design.md`.

## Testing & verification

Per commit:

- `pnpm install` resolves the new `workspace:*` link (for example commits).
- `pnpm -r typecheck` passes (covers `_shared` and every example via `tsc --noEmit`).
- `pnpm check` is clean (Biome lint + format), with `pnpm check:fix` applied
  before commit.
- `pnpm --filter <example> dev` starts; the themed `ControlPanel` renders, its
  controls work, and the map still pans/zooms (manual smoke check). For
  `naip-mosaic` / `dynamical-zarr-ecmwf` / `aef-mosaic` also confirm the
  dual-thumb `RangeSlider` and (where present) the `ColormapPreview` look right;
  for `land-cover` confirm the `CategoryFilter` tree (incl. indeterminate
  master) still works.

## Open questions

None blocking. Resolved during brainstorming:

- Scope of new shared components: the roadmap items serving ≥2 examples
  (`RangeSlider`, `HelpTooltip`, `ColormapPreview`); `CategoryFilter` and
  `SwipeHandle` stay local.
- Delivery: one branch / PR, staged commits with review pauses.
- `CategoryFilter` rewritten in Chakra `Checkbox`; `SwipeHandle` left as a
  vanilla positioned div (lightly restyled if needed).
- Panel-file placement: keep whatever each example has today (inline-in-`App.tsx`
  stays inline; `src/ui/control-panel.tsx` stays a file).
- ECMWF play/pause: use `CollecticonCirclePlay` / `CollecticonCirclePause` (the
  collecticons set has them), drop the local SVG components.
