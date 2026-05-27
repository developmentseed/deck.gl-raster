# GlobeReprojector: sphere-aware adaptive meshing

- **Date:** 2026-05-27
- **Issues:** Follow-up to [#563](https://github.com/developmentseed/deck.gl-raster/pull/563) (Initial Globe view support); replaces the throwaway uniform-grid scaffold from [#563](https://github.com/developmentseed/deck.gl-raster/pull/563).
- **Status:** Draft (pending review)

## Summary

Replace the throwaway uniform-grid globe mesh (`buildUniformGridMesh`) with a
`GlobeReprojector` that adds a **curvature (sag)** term to the mesh-refinement
metric, so the adaptive Delatin mesh stays accurate on the sphere instead of
faceting at low zoom.

`GlobeReprojector` is a subclass of `RasterReprojector` that lives in
**`deck.gl-raster`**, not the generic `raster-reproject` package — because it
legitimately needs deck.gl [`GlobeView`](https://deck.gl/docs/api-reference/core/globe-view)'s projection to measure sag. The base
`RasterReprojector` gains a handful of small, **behavior-preserving**
extensibility seams and learns nothing about spheres.

## Background / Problem

`RasterReprojector` ([Delatin](https://github.com/mapbox/delatin)) refines triangles by **reprojection error**,
measured in **input raster pixels** — the deviation between the linearly
interpolated sample and the exact reprojection ([delatin.ts](../../packages/raster-reproject/src/delatin.ts) `_findReprojectionCandidate`). This
metric deliberately mirrors GDAL's [approximate transformer](https://gdal.org/en/stable/programs/gdalwarp.html#approximate-transformation) (`gdalwarp -et`), and
**must be preserved** for the planar case.

That metric is **blind to sphere curvature**. For an EPSG:4326 source the
reprojection is near-linear, so pixel error is ~0 and Delatin emits just two
triangles. On a globe those two triangles chord straight through the sphere and
visibly facet at low zoom.

The current stopgap is [`buildUniformGridMesh`](../../packages/deck.gl-raster/src/globe-grid-mesh.ts) — a 32×32 uniform grid per
tile, explicitly marked THROWAWAY (see the [globe-view design](./2026-05-21-globe-view-design.md)). It is dense everywhere regardless of where
curvature actually matters. This spec replaces it.

### Key facts that shape the design

- **The rendered mesh position is lng/lat, not sphere xyz.** deck.gl `GlobeView`
  projects lng/lat → sphere in the vertex shader. So the mesh `POSITION`
  attribute stays lng/lat (fp64 hi/lo), exactly as today. The sphere positions
  we compute are used **only** by the sag metric — they are never emitted.
  `GlobeReprojector` therefore produces the **same mesh format** as
  `RasterReprojector`; `reprojectorToMesh` and the debug layer work on it
  unchanged.
- **The reprojector is viewport-independent, and stays that way.** Each tile
  gets its own reprojector → its own mesh, built once. Zoom changes which
  tiles/overviews are resident; it never regenerates a tile's mesh. We do **not**
  make the reprojector zoom-aware.

## Goals / Non-goals

**Goals**

- Sphere-aware adaptive refinement: dense where the surface is curved, sparse
  where it is flat.
- Zoom-independent: one mesh per tile, never rebuilt on zoom.
- Preserve the planar/GDAL pixel metric byte-for-byte.
- Keep `raster-reproject` free of any globe/sphere/deck.gl concept.

**Non-goals (explicitly deferred, but not foreclosed)**

- **GCP-based seeding.** The `_seed()` hook (below) is the natural future home
  for triangulating from Ground Control Points, but we do not build it now.
- Antimeridian handling (tracked separately).
- Pole singularity. Near the poles the reprojection never fully converges; the
  existing `maxIterations` safeguard still applies. Sag refinement does not make
  this worse.

## Design overview

Three pieces:

1. **`RasterReprojector` (raster-reproject)** — add behavior-preserving
   extensibility seams. No globe concepts.
2. **`GlobeReprojector` (deck.gl-raster)** — subclass adding the sphere cache,
   the sag metric, and a two-tolerance `run`.
3. **`RasterLayer` (deck.gl-raster)** — the globe branch builds a
   `GlobeReprojector` through the existing `reprojectorToMesh` path, and the
   uniform-grid hack is deleted.

## Component 1 — `RasterReprojector` extensibility seams

All edits are **behavior-preserving**: the planar output is identical, existing
tests pass unchanged. The seams are projection-agnostic (equally useful for the
future GCP case or any custom metric).

### 1a. Make `_addPoint` overridable

`_addPoint` is `private` today ([delatin.ts:376](../../packages/raster-reproject/src/delatin.ts#L376)). Change to
`protected`. No logic change.

### 1b. Extract the scoring seam

Today the per-sample pixel error is computed inline in the sampling loop of
`_findReprojectionCandidate` ([delatin.ts:296-298](../../packages/raster-reproject/src/delatin.ts#L296-L298)). Extract the per-sample scalar
into a `protected` method, default = today's pixel error:

```ts
/**
 * Per-sample refinement error. The triangle's queue priority is the max of
 * this over its sample points, and the split candidate is the argmax sample.
 *
 * Default: the reprojection error in input pixels (GDAL-like). Subclasses may
 * return a different scalar; the value's units define what `run`'s tolerance
 * means.
 */
protected _sampleError(ctx: SampleErrorContext): number {
  return ctx.pixelError; // hypot(dx, dy), unchanged behavior
}
```

`SampleErrorContext` carries everything the base already computes for the
sample, so the seam never recomputes: the barycentric weights, the three
triangle vertex indices, the interpolated output position, and the base's
`pixelError`. The base loop calls `_sampleError`, tracks its max + the
corresponding uv as the split candidate, and pushes the max to the queue —
structurally identical to today, just routed through the seam.

### 1c. Lazy seeding via `_seed()` + `_ensureSeeded()`

Today the constructor seeds the initial 4 corners + 2 triangles and flushes
([delatin.ts:138-146](../../packages/raster-reproject/src/delatin.ts#L138-L146)). Move that body into a `protected _seed()` and call it
lazily:

```ts
constructor(...) { /* allocate empty arrays only — no _addPoint, no _flush */ }

protected _seed(): void { /* today's lines 138-146 */ }

private _ensureSeeded(): void {
  if (this.triangles.length === 0) this._seed();
}

run(...)  { this._ensureSeeded(); /* existing loop */ }
refine()  { this._ensureSeeded(); /* existing body */ }
```

**Why:** in JS/TS a base constructor runs fully **before** subclass field
initializers. If the constructor calls `_addPoint` (which a subclass overrides
to touch `renderPositions`), `renderPositions` is still `undefined`. Moving
seeding to first-`run()`/`refine()` means the object is fully constructed —
subclass fields initialized — before any `_addPoint` fires. This also makes
`_seed()` the clean override point for the future GCP case.

**Observable change:** `triangles`/`uvs` are empty between construction and the
first `run()`/`refine()`. Nothing reads them in that window
([raster-layer.ts](../../packages/deck.gl-raster/src/raster-layer.ts) constructs then immediately runs).

### 1d. `_reevaluate()` for tolerance changes

```ts
/** Re-score every existing triangle through `_sampleError` and rebuild the
 *  queue. Used when run-time scoring inputs (e.g. tolerances) change between
 *  runs so a stale, differently-scored queue isn't reused. */
protected _reevaluate(): void { /* mark all triangles pending, _flush */ }
```

Projection-agnostic. The base never calls it (its queue holds raw,
tolerance-free pixel error); it exists for subclasses whose scoring depends on
run-time inputs.

### Public API

No new public exports from `raster-reproject`. The seams are `protected`;
`RasterReprojector` is already exported and subclassable. The package boundary
**enforces** the clean seam: a subclass in `deck.gl-raster` physically cannot
touch the base's `private` queue internals, so the extension surface stays the
narrow set of `protected` hooks above.

## Component 2 — `GlobeReprojector` (deck.gl-raster)

New file `packages/deck.gl-raster/src/globe-reprojector.ts`. Internal to the
package (not exported from `index.ts`) until there's an external use case.

### 2a. The render-position cache

```ts
/** Sphere positions (deck.gl GlobeView common space), stride 3, indexed by
 *  vertex — parallel to the base's `exactOutputPositions` (stride 2). */
renderPositions: number[] = [];
```

A plain field initializer is safe now that seeding is lazy (1c).

### 2b. `_addPoint` override

```ts
protected override _addPoint(u: number, v: number): number {
  const i = super._addPoint(u, v); // pushes uv + exact lng/lat as today
  const lng = this.exactOutputPositions[2 * i]!;
  const lat = this.exactOutputPositions[2 * i + 1]!;
  const [x, y, z] = this._projectToSphere(lng, lat);
  this.renderPositions.push(x, y, z); // slot i, stride 3
  return i;
}
```

`_projectToSphere` is deck.gl `GlobeView`'s lng/lat → common-space sphere
mapping (view-independent, constant radius `R`). Because we're in
`deck.gl-raster`, we use deck.gl's projection directly — no injection.

### 2c. The sag metric — definition

**Sag is the gap between the flat triangle the GPU draws and the round sphere
surface deck.gl wants.** deck.gl fills a triangle as a flat facet between its
three projected vertices; it does not re-project interior pixels. So the facet
dips inside the sphere. The deeper the dip, the more faceted it looks.

Decompose an interior point's error into two orthogonal components:

- **Radial** (toward/away from the globe center): the facet sits below the
  sphere. Pure geometry — exists even with a perfect texture. **This is sag.**
- **Tangential** (along the surface): the texture lands slightly off because the
  CRS→lng/lat map is nonlinear. **This is the existing pixel error.**

They don't overlap, which is exactly why two independent tolerances are clean.

**Formula.** Every flat-raster vertex sits at the same radius `R` from the globe
center (z=0, no elevation). The rendered interior point is the barycentric mix
of the three cached corner positions, which lands at radius `< R`. The closest
point on a sphere is always radial, so the perpendicular distance from the facet
point to the sphere is exact:

```
sag(sample) = R − | barycentricMix(renderPos_a, renderPos_b, renderPos_c) |
```

No extra projection, no lng/lat interpolation — just the cached corner positions
and one vector length. Normalizing by `R` gives a dimensionless **relative dip**
(`1 − |mix|/R`), making the sag tolerance resolution- and zoom-independent.

> **Rejected alternative:** the full 3-D distance to `sphere(exactReproject(sample))`.
> It costs an extra projection per sample *and* folds the tangential/texture
> error back into sag, double-counting the pixel metric. The radial measure is
> cheaper and properly orthogonal.

### 2d. The scoring seam override — two tolerances, normalized

The priority queue needs **one** scalar per triangle to decide what to split
next. Pixel error (input pixels) and sag (relative dip) are different units, so
rank by how badly each blows its own budget:

```ts
protected override _sampleError(ctx: SampleErrorContext): number {
  const sag = this._relativeSag(ctx); // (R − |mix|)/R from cached corners + weights
  return Math.max(
    ctx.pixelError / this._pixelTolerance,
    sag / this._sagTolerance,
  );
}
```

`max(px/pxTol, sag/sagTol) > 1` is identically `px > pxTol OR sag > sagTol` — so
this **is** two independent tolerances in their native units; the division only
makes them rankable in one queue. The split candidate is the sample maximizing
this normalized value (so the most-over-budget point is added first).

The base planar metric is this with `sagTolerance = ∞` (sag term vanishes,
score = `px/pxTol`). `GlobeReprojector` strictly generalizes the base.

### 2e. `run` — tolerances are per-run inputs

Tolerance is a property of *a run*, not of the reprojector, and may change
between runs. So both tolerances arrive at `run`. Concretely, convert the base
`run` to an options object and extend it:

```ts
// base (raster-reproject)
run(options?: { maxError?: number; maxIterations?: number }): void

// GlobeReprojector
run(options?: {
  pixelTolerance?: number;   // input pixels (GDAL-like), default e.g. 0.125
  sagTolerance?: number;     // relative dip, default tuned visually
  maxIterations?: number;
}): void {
  this._pixelTolerance = options?.pixelTolerance ?? DEFAULT_PIXEL_TOLERANCE;
  this._sagTolerance   = options?.sagTolerance   ?? DEFAULT_SAG_TOLERANCE;
  if (tolerancesChangedSinceLastRun) this._reevaluate();
  this._ensureSeeded();
  while (this.getMaxError() > 1) this.refine(); // seam is normalized → threshold 1
}
```

`_pixelTolerance`/`_sagTolerance` are **transient run state** (set at `run`
entry, read by the seam during that run), not persistent configuration — the
public contract is still "supply tolerances per `run` call." Re-running with
different tolerances on the same instance triggers `_reevaluate()` first; in
practice the layer builds a fresh reprojector per tolerance change, so this is a
correctness safeguard, not a hot path.

> Converting base `run(maxError)` → `run({ maxError })` is a small, principled
> API change touching the one call site we own ([raster-layer.ts](../../packages/deck.gl-raster/src/raster-layer.ts)). It keeps the
> override signature compatible. **Flagged for review** (alternative: keep
> `run(maxError)` and reuse it with `maxError = 1` plus a separate tolerance
> channel — uglier).

## Component 3 — `RasterLayer` wiring

In `_generateMesh` ([raster-layer.ts:205-228](../../packages/deck.gl-raster/src/raster-layer.ts#L205-L228)), the globe branch currently calls
`buildUniformGridMesh`. Replace with a `GlobeReprojector`, then reuse the
**existing** `reprojectorToMesh` path (positions = lng/lat, unchanged):

```ts
const reprojector = isGlobe
  ? new GlobeReprojector(reprojectionFns, width + 1, height + 1)
  : new RasterReprojector(reprojectionFns, width + 1, height + 1);
reprojector.run(isGlobe ? { sagTolerance, pixelTolerance: maxError } : { maxError });
const mesh = reprojectorToMesh(reprojector);
```

- `isGlobe` detection stays as-is (`viewport.resolution !== undefined`).
- `reprojector` is stored in state for both branches → the debug layer now works
  on the globe (today it's `undefined` for globe).
- **Delete** `globe-grid-mesh.ts` and its `buildUniformGridMesh` import.
- Add a `sagTolerance` prop to `RasterLayerProps` (default tuned visually),
  threaded down from the COG/globe example.

## Data flow

```
tile load → RasterLayer._generateMesh
  → new GlobeReprojector(reprojectionFns, w+1, h+1)
  → run({ pixelTolerance, sagTolerance })
       _ensureSeeded → _seed → _addPoint ×4 (caches sphere xyz) → _flush
       refine loop: _step → _addPoint (caches) ; _flush → _findReprojectionCandidate
         per sample → _sampleError = max(px/pxTol, sag/sagTol)   [sag from renderPositions]
       until getMaxError() ≤ 1
  → reprojectorToMesh (lng/lat positions, fp64 hi/lo) → MeshTextureLayer
  → GlobeView projects lng/lat → sphere in the vertex shader
```

## Error handling / edge cases

- **Poles:** unchanged non-convergence risk; `maxIterations` warns and bails
  ([delatin.ts:168-176](../../packages/raster-reproject/src/delatin.ts#L168-L176)). Sag pushes more refinement near curved regions but does
  not introduce a new failure mode.
- **Degenerate `R`:** all vertices share `R`; deriving it from the projection is
  safe. Guard against `sagTolerance ≤ 0` (throw, like `maxError ≤ 0` today).
- **`renderPositions` / `exactOutputPositions` alignment:** guaranteed by
  pushing in lockstep inside `_addPoint`; both indexed by vertex ordinal.

## Testing strategy

- **Base unchanged:** existing `raster-reproject` tests pass after the seam
  extraction + lazy seeding (behavior-preserving).
- **Lazy seeding:** constructing a reprojector leaves `triangles`/`uvs` empty;
  `run()`/`refine()` seeds.
- **Sag formula:** given three known sphere corner positions, `sag` equals the
  analytic radial gap (e.g. a chord subtending angle θ → `R(1−cos(θ/2))` at the
  midpoint).
- **Sag-driven refinement:** a large EPSG:4326 tile (pixel error ≈ 0) refines
  into many triangles under `GlobeReprojector`, vs. 2 under the base — proving
  the curvature term drives subdivision the pixel metric misses.
- **Generalization:** `GlobeReprojector` with `sagTolerance = ∞` reproduces the
  base mesh (pixel-only).
- **Tolerance change:** `_reevaluate()` re-scores existing triangles; a second
  `run` with a tighter `sagTolerance` yields a denser mesh.

## Open questions / to confirm during implementation

1. **`_projectToSphere` source.** Confirm the exact deck.gl API for a
   view-independent lng/lat → common-space sphere position (and `R`). If deck.gl
   only exposes it via a viewport, use a canonical globe viewport or replicate
   the small spherical formula. Design is unaffected.
2. **Default `sagTolerance`.** Needs visual tuning on the globe example; ship a
   sensible default (relative dip) and expose the prop.
3. **`run` options-object refactor** (Component 2e) — confirm preferred over the
   alternative.
