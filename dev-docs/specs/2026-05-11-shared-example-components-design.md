---
title: Shared example components — design
date: 2026-05-11
status: approved
---

# Shared example components

## Goal

Create `examples/_shared/` — a private workspace package of reusable React UI
components shared across the demo apps in `examples/`. Today all nine examples
hand-roll the same scaffolding: an identical `DeckGLOverlay` wrapper, an
identical full-screen overlay container, and a near-identical floating
collapsible white control panel with inline styles. `_shared` consolidates
that into a small Chakra UI v3 component kit, mirroring the
`examples/_shared/` setup in
[`deck.gl-healpix`](https://github.com/developmentseed/deck.gl-healpix)
(see [PR #5 review](https://github.com/developmentseed/deck.gl-healpix/pull/5/changes/BASE..53c7862764a5ef1b647a6ad7d71294c72579411e#r3210318213)),
adapted to this repo's tooling (pnpm workspaces, Biome).

This is issue
[#519](https://github.com/developmentseed/deck.gl-raster/issues/519).

Scope of the first PR: stand up the package + a v1 component set, and migrate
two pilot examples (`sentinel-2` and `cog-basic`). The component set is
designed against *all nine* examples so it actually serves them; migrating the
remaining seven is follow-up work (see [Roadmap](#follow-up-roadmap)).

Changing the visual appearance of existing examples is in scope — the goal is
a consistent shared look, not preservation of each example's bespoke styling.

## Non-goals

- **Not migrating all nine examples in this PR.** Only `sentinel-2` and
  `cog-basic`. The rest follow once the API has been validated against the two
  pilots.
- **No shared build scaffolding** (`createExampleViteConfig`, shared
  `index.html`, etc.). Examples must stay readable and copy-pasteable; per-
  example `vite.config.ts` and `index.html` stay as they are. A shared CSS
  reset import is deferred unless the boilerplate proves annoying.
- **No build step for `_shared`.** It ships TypeScript source consumed
  directly by Vite (transpile) and `tsc --noEmit` (typecheck), like healpix's
  `_shared`. No `tsup`, no `dist`.
- **No changes to the published packages** (`@developmentseed/deck.gl-raster`,
  `@developmentseed/deck.gl-geotiff`, …) or to `examples/tsconfig.base.json`.
- **No unit-test suite for `_shared` v1.** It's a thin presentational/glue
  layer with no business logic; the examples themselves are untested. A
  non-trivial util added later (e.g. a color-scale builder) gets a Vitest test
  at that point.
- **Not porting healpix's `PageLayout`** (router + header + logo). Our examples
  are single-page full-screen maps, not multi-page sites.
- **Not bringing in `react-router`, `d3`, or the dual-thumb slider yet.** Those
  arrive with the follow-up widgets that need them.

## Background — what the nine examples share

Survey of `src/App.tsx` and `src/ui/`, `src/components/` across all nine
examples (`aef-mosaic`, `cog-basic`, `dynamical-zarr-ecmwf`, `land-cover`,
`naip-mosaic`, `sentinel-2`, `usgs-topo-cutline`, `vermont-cog-comparison`,
`zarr-sentinel2-tci`):

| Pattern | Examples | Notes |
|---|---|---|
| `DeckGLOverlay` snippet (`useControl(() => new MapboxOverlay(props)); overlay.setProps(props)`) | 9/9 byte-identical | trivial extract |
| Full-screen `position:absolute; inset:0; pointerEvents:none; zIndex:1000` overlay wrapper | 9/9 | `land-cover` already factored it out as `UIOverlay` |
| Floating collapsible white control panel, top-left, `padding:16px`, `borderRadius:8px`, `boxShadow:0 2px 8px rgba(0,0,0,0.1)`, header row + rotating-chevron toggle, `pointerEvents:auto` | 9/9 ~identical (width 290–350px varies) | **biggest consolidation win** |
| Native `<select>` / `<input type=checkbox>` / `<input type=range>` with 12–13px `#666` labels | 9/9 | becomes Chakra primitives in a labeled `Field` |
| External links (`target="_blank" rel="noopener noreferrer"`) incl. a "deck.gl-raster Documentation ↗" link to `https://developmentseed.org/deck.gl-raster/` | 9/9 | trivial extract |
| Tile-debug controls: "Debug overlay" checkbox, then a detail-level select + opacity slider | 6/9 | consolidate |
| Dual-thumb range slider via raw `@radix-ui/react-slider` | 3/9 (`aef-mosaic`, `dynamical-zarr-ecmwf`, `naip-mosaic`) | Chakra v3 `Slider` is multi-thumb → drop the radix dep when migrated |
| Help/info tooltip icon (two impls: `InfoTooltip`, `HelpIcon`) | 2/9 | consolidate |
| Nested indeterminate checkbox tree | 1/9 (`land-cover` `CategoryFilter`) | specialized, later |
| Draggable swipe divider | 1/9 (`vermont-cog-comparison` `SwipeHandle`) | specialized, later |
| Colormap preview / colorbar legend | 2–3/9 | later |
| `index.html` body/`#root` reset boilerplate | 9/9 ~identical | minor, not consolidated in v1 |
| `vite.config.ts` shape (react plugin, `base: "/deck.gl-raster/examples/<name>/"`, port, `worker: { format: "es" }`) | 9/9 ~identical | minor, not consolidated in v1 |

No example currently uses Chakra, emotion, styled-components, or any CSS-in-JS;
`@radix-ui/react-slider` is the only component-library dependency (3/9).
`examples/*` is already a `pnpm-workspace.yaml` glob, so an `examples/_shared`
folder is automatically a workspace member.

## Architecture

### Package & wiring

```
examples/_shared/
  package.json          # name: "deck.gl-raster-examples-shared", private, type: module
  tsconfig.json         # extends ../tsconfig.base.json; include: ["."]
  README.md
  index.ts              # barrel — the only entry point (exports: { ".": "./index.ts" })
  components/
    deckgl-overlay.tsx
    ui-overlay.tsx
    control-panel.tsx
    external-link.tsx
    field.tsx
    debug-controls.tsx
    provider.tsx
  styles/
    theme.ts
    color-palette.ts
  utils/                # empty in v1
```

- **Name / privacy.** `package.json`: `{ "name": "deck.gl-raster-examples-shared", "private": true, "type": "module", "version": "0.0.0" }` plus a `"typecheck": "tsc --noEmit"` script so `pnpm -r typecheck` covers it. Unscoped name signals "internal, not published."
- **Entry point.** A single `index.ts` barrel; `exports: { ".": "./index.ts" }`. Examples import everything from the package root:
  `import { ControlPanel, DeckGlOverlay, ExampleProvider } from "deck.gl-raster-examples-shared"`.
  Rationale: a barrel sidesteps `.tsx`-vs-`.ts` subpath-export resolution
  fiddliness, and "minimal public API" discipline targets the *published*
  packages, not an internal dev-only helper. (Scoped subpath exports remain a
  viable alternative if preferred.)
- **No build step.** `exports`/`main` point at source. Vite transpiles it;
  `tsc --noEmit` (the examples' existing `typecheck` script) typechecks it.
- **Dependencies of `_shared`:** `@chakra-ui/react` (v3), `@emotion/react`,
  `react`, `@deck.gl/mapbox` (for `DeckGlOverlay` prop types), `react-map-gl`
  (for `useControl`), `polished` (for the color-palette generator). Versions
  match the rest of the repo / the examples (`react ^19.2.4`,
  `@deck.gl/mapbox ^9.3.1`, `react-map-gl ^8.1.0`, Chakra v3 latest).
- **Each adopting example** adds to its own `package.json`:
  `"deck.gl-raster-examples-shared": "workspace:*"`, `"@chakra-ui/react"`,
  `"@emotion/react"` — examples also use Chakra primitives directly in their
  `App.tsx`, exactly as healpix's `sandbox` does.
- **`examples/_shared/tsconfig.json`** extends `examples/tsconfig.base.json`
  with `"include": ["."]`. No `tsBuildInfoFile` needed (no project refs).
- **Biome.** All `_shared` source follows the repo's Biome config (2-space,
  double quotes, semicolons, trailing commas, `useImportType`,
  `useBlockStatements`). `pnpm check:fix` is run before commit.

### v1 component set

Each item is a named export from `index.ts`. All take a single props object
(no more than ~2 positional args anywhere) and carry JSDoc docstrings on the
exported component and its props interface.

#### `DeckGlOverlay` — `components/deckgl-overlay.tsx`

The `react-map-gl/maplibre` ↔ deck.gl bridge, lifted verbatim from the nine
copies:

```tsx
import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useControl } from "react-map-gl/maplibre";

/** Renders deck.gl layers as an overlay on a react-map-gl (MapLibre) `<Map>`. */
export function DeckGlOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}
```

#### `UIOverlay` — `components/ui-overlay.tsx`

Full-screen, click-through container for overlay UI, lifted from
`land-cover/src/components/UIOverlay.tsx`. `position:absolute; inset:0;
width/height:100%; pointerEvents:none; zIndex:1000`. Children opt back into
pointer events. Optional in single-panel examples (`ControlPanel` positions
itself); useful when an example stacks multiple overlay widgets (panel +
legend + colorbar).

```tsx
/** Full-screen, click-through layer for positioning overlay UI above the map. */
export function UIOverlay(props: { children: React.ReactNode }) { … }
```

#### `ControlPanel` — `components/control-panel.tsx`

The floating collapsible panel. A positioned Chakra `Box` (white background,
`p="4"`, `borderRadius="lg"`, `boxShadow`, `pointerEvents:auto`) with a header
row: the title plus a chevron button that collapses/expands the body. Manages
its own open/closed state.

```tsx
type ControlPanelPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

interface ControlPanelProps {
  /** Heading shown in the panel header. */
  title: React.ReactNode;
  /** Corner to anchor to. Default `"top-left"`. */
  position?: ControlPanelPosition;
  /** Whether the body starts expanded. Default `true`. */
  defaultOpen?: boolean;
  /** Panel width (any Chakra size token or CSS length). Default `"350px"`. */
  width?: string;
  children: React.ReactNode;
}

export function ControlPanel(props: ControlPanelProps) { … }
```

(If a panel needs externally-controlled open state later, add optional
`open` / `onOpenChange` then — not in v1.)

#### `ExternalLink`, `DocsLink` — `components/external-link.tsx`

```tsx
/** `<a>` that opens in a new tab with `rel="noopener noreferrer"`. */
export function ExternalLink(props: { href: string; children: React.ReactNode }) { … }

/** The recurring "deck.gl-raster Documentation ↗" link. */
export function DocsLink(props?: { href?: string; children?: React.ReactNode }) { … }
// default href: https://developmentseed.org/deck.gl-raster/
// default text: "deck.gl-raster Documentation ↗"
```

Built on Chakra's `Link`.

#### `Field` — `components/field.tsx`

Thin wrapper around Chakra v3's `Field.Root` + `Field.Label` producing the
consistent small-gray-label look. The control itself is `children` — examples
drop a Chakra `NativeSelect.Root`/`Checkbox.Root`/`Slider.Root` inside.

```tsx
interface FieldProps {
  /** Label text rendered above (or beside) the control. */
  label: React.ReactNode;
  /** Optional helper text below the control. */
  helperText?: React.ReactNode;
  children: React.ReactNode;
}

export function Field(props: FieldProps) { … }
```

#### `DebugControls` — `components/debug-controls.tsx`

The tile-debug cluster used by 6/9 examples (notably `sentinel-2`). A "Debug
overlay" checkbox; when on, a detail-level select (1 Compact / 2 Detailed / 3
Verbose) and an opacity slider. Fully controlled.

```tsx
interface DebugState {
  debug: boolean;
  debugLevel: 1 | 2 | 3;
  debugOpacity: number; // 0–1
}

interface DebugControlsProps {
  value: DebugState;
  onChange: (next: DebugState) => void;
}

export function DebugControls(props: DebugControlsProps) { … }
```

#### `ExampleProvider` — `components/provider.tsx`

`<ChakraProvider value={system}>` (plus default light color mode). Examples
wrap `<App/>` in it in `main.tsx`:

```tsx
import { ExampleProvider } from "deck.gl-raster-examples-shared";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ExampleProvider>
      <App />
    </ExampleProvider>
  </StrictMode>,
);
```

#### `system` + `createColorPalette` — `styles/theme.ts`, `styles/color-palette.ts`

`color-palette.ts` is ported from healpix: a `polished`-based generator that
expands a base color into a 50–900 (+ `…a` alpha) Chakra color scale.
`theme.ts` calls `createSystem(defaultConfig, defineConfig({ theme: { tokens:
{ colors: { brand: createColorPalette("<deck.gl-raster brand color>"), … } } } }))`
and exports the resulting `system`. Brand color: a blue in the neighbourhood
of healpix's `#1E7BC6`, refined during implementation to suit the docs site.

### Data flow

`_shared` holds no application state. `ControlPanel` and `DebugControls` own
only ephemeral UI state (collapsed flag; for `DebugControls`, the value is
lifted to the example). Examples remain the single source of truth for layer
config and pass it down. `DeckGlOverlay` is a pure pass-through to
`MapboxOverlay.setProps`.

### Error handling

Nothing new. Components are presentational; bad props surface as TypeScript
errors. No runtime validation, no error boundaries (an example that throws
should fail loudly in dev, as today).

## Pilot migrations (this PR)

### `cog-basic` — minimal pilot

- `main.tsx`: wrap `<App/>` in `<ExampleProvider>`.
- `App.tsx`: remove the local `DeckGLOverlay` snippet → import from `_shared`;
  replace the inline-styled floating `<div>` with `<ControlPanel title="…">`;
  intro `<p>` + docs link → prose + `<DocsLink/>`; any `<select>`/`<input>`
  → Chakra primitives wrapped in `<Field>`.
- `package.json`: add `deck.gl-raster-examples-shared`, `@chakra-ui/react`,
  `@emotion/react`.
- Outcome: `App.tsx` shrinks; the panel adopts the Chakra theme.

### `sentinel-2` — rich pilot

- Same `ExampleProvider` + `DeckGlOverlay` swap.
- The hand-rolled panel (collapsible header; "Scene" and "Composite"
  `<select>`s; "Debug overlay" checkbox; detail-level `<select>`; opacity
  `<input type=range>`; three external links) becomes:
  `<ControlPanel title="Sentinel-2 Multi-Band">` containing prose +
  `<DocsLink/>`, two `<Field label="Scene">/<Field label="Composite">`
  wrapping Chakra `NativeSelect`s, and `<DebugControls value={…}
  onChange={…}/>` replacing the entire debug block.
- `package.json`: add the three deps.
- This is the real test that `ControlPanel` + `Field` + `DebugControls` +
  `DocsLink` cover a busy example end-to-end. If something doesn't fit, the API
  changes here before it's written down.

## Follow-up roadmap

Not in this PR; recorded so the v1 API is shaped with them in mind:

1. Migrate the remaining seven examples to `_shared` (`aef-mosaic`,
   `dynamical-zarr-ecmwf`, `land-cover`, `naip-mosaic`, `usgs-topo-cutline`,
   `vermont-cog-comparison`, `zarr-sentinel2-tci`).
2. `HelpTooltip` — consolidates `aef-mosaic`'s `InfoTooltip` and `land-cover`'s
   `HelpIcon` (Chakra `Tooltip`).
3. `RangeSlider` (dual-thumb) — Chakra v3 `Slider` is multi-thumb natively;
   consolidates the three raw `@radix-ui/react-slider` usages and lets those
   examples drop the dep.
4. `CategoryFilter` — `land-cover`'s nested indeterminate checkbox tree.
5. `SwipeHandle` — `vermont-cog-comparison`'s draggable divider.
6. `Colorbar` / `ColormapPreview` + `utils/sequential-color-scale.ts` —
   colormap legend and picker (used by `naip-mosaic`, `dynamical-zarr-ecmwf`,
   and a port of `land-cover`'s legend).
7. *(Optional, low priority)* shared CSS reset import and/or
   `createExampleViteConfig` helper — only if per-example boilerplate proves
   annoying; deliberately deferred to keep examples copy-pasteable.

## Testing & verification

- `pnpm install` resolves the new `workspace:*` link.
- `pnpm -r typecheck` passes — covers `_shared` and both migrated examples via
  `tsc --noEmit`.
- `pnpm --filter deck.gl-sentinel-2-example dev` and the `cog-basic` dev server
  start; the themed `ControlPanel` renders, its controls work, and the map
  still pans/zooms (manual smoke check).
- `pnpm check` is clean (Biome lint + format), with `pnpm check:fix` applied
  before commit.

## Open questions

None blocking. Resolved during brainstorming:

- Wiring: pnpm workspace package (not path aliases or relative imports).
- Entry point: barrel `index.ts` (scoped subpath exports remain an option).
- `Field` wrapper: kept.
- Theme: port healpix's `createColorPalette` + `polished`.
- Pilots: `sentinel-2` (rich) and `cog-basic` (minimal).
