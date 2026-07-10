# LOD selection and pixel matching

This doc explains how `deck.gl-raster` decides which tile pyramid level
to fetch for any given view, and what the relationship is between a
source raster's pixel size and a screen pixel. The logic is short but
the assumptions baked into it are not obvious. This doc names them.

For the difference between *viewport zoom* and *tile z-index*, see
[zoom-terminology.md](zoom-terminology.md). The criterion described
here uses both.

## The two quantities

The LOD criterion compares two ground-meters quantities, one from the
data, one from the viewport.

**`tileMetersPerPixel`** — how many ground meters one source pixel
covers. Defined per `TilesetLevel`:

- For OGC `TileMatrixSet` levels, computed from the matrix's
  `scaleDenominator` and the OGC standard pixel size (0.28 mm) at
  [tile-matrix-set.ts:34](../packages/deck.gl-raster/src/raster-tileset/tile-matrix-set.ts#L34).
- For `AffineTilesetLevel` (geotiff overviews, geozarr multiscales),
  computed from the affine transform's pixel scale times a
  meters-per-CRS-unit factor at [affine-tileset-level.ts:59](../packages/deck.gl-raster/src/raster-tileset/affine-tileset-level.ts#L59).

It is a single value per level. It does not vary across the level's
extent.

**`metersPerScreenPixel`** — how many ground meters one *CSS* pixel of
the framebuffer covers. Computed per tile from the viewport zoom and
the tile's bounding-volume center latitude at
[raster-tile-traversal.ts:764-770](../packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts#L764-L770):

```
metersPerScreenPixel = earthCircumference · cos(lat) / 2^(zoom + 8)
```

The `+8` reflects the OSM convention that viewport zoom 0 fits the
world into a 256-pixel-wide tile (2^8). The `cos(lat)` is the standard
Web Mercator latitude distortion: a CSS pixel near the pole covers
fewer ground meters than one at the equator at the same viewport zoom.

## The criterion

The LOD test in
[raster-tile-traversal.ts:286-302](../packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts#L286-L302):

```ts
if (tileMetersPerPixel <= metersPerScreenPixel || ...) {
  this.selected = true;
}
```

Read: *"source pixel ≤ screen pixel in ground meters"* — the source
resolution is at least as fine as the screen resolution. The traversal
walks the pyramid coarse-to-fine, so the first level satisfying this is
the *coarsest* level that doesn't blur. That's the right choice: any
finer would send more data than the screen can resolve.

Compare to upstream's OSM traversal in
`@deck.gl/geo-layers`'s `tileset-2d/tile-2d-traversal.ts`:

```ts
const distance = boundingVolume.distanceTo(viewport.cameraPosition)
                 * viewport.scale / viewport.height;
z += Math.floor(Math.log2(distance));
```

Same idea — adjust the selected level by how much the screen scales
the tile — but expressed in OSM-zoom integer steps, valid only because
OSM tile z and viewport zoom are equal by construction. The
`metersPerPixel` form generalizes to arbitrary tiling grids and source
CRSes.

## Per-tile LOD already varies

A common assumption is that a render selects a single z-level for all
visible tiles. That is **not** what happens. The criterion is evaluated
in the per-tile `update()` recursion, with `metersPerScreenPixel`
computed at *that* tile's bounding-volume center. A tile at lat = 70°
gets a smaller `metersPerScreenPixel` than one at lat = 0° at the same
viewport zoom, so it can be satisfied at a coarser level. Visible sets
typically span multiple levels, especially in views that cover a wide
latitude band.

Worth flagging because the question "should LOD vary by latitude?"
naturally arises alongside
[issue #89](https://github.com/developmentseed/deck.gl-raster/issues/89).
On the *screen* side, it already does. Issue #89 is specifically
about the *source* side — see "What the criterion does not account
for" below.

## What the criterion accounts for

**Web Mercator data on a Web Mercator screen.** The `cos(lat)` factor
appears in `metersPerScreenPixel` and is also implicit in any Mercator
source's projection (tile-aligned grids in Mercator have uniform pixel
size in *Mercator units* but cosine-shrunk in ground meters). Both
sides shrink the same way at the same latitude, so the comparison is
correct even though `tileMetersPerPixel` uses the equator-equivalent
value from the OGC scale denominator. The distortion cancels.

**Globe view.** Bounding volumes are constructed from sample points
projected through the source-to-3857 path, capturing the sphere's
geometry. Frustum culling rejects out-of-view tiles before the LOD
test runs.

**Mixed-CRS source data.** Reference points sampled from the tile in
its native CRS, projected to EPSG:3857, then rescaled to common space.
The bounding volume reflects the actual on-globe footprint.

## What the criterion does not account for

Four named gaps. Two are accepted limitations; one is addressed by
the criterion change described below; one is a sketch of how a future
redesign would collapse them.

### (A) CSS vs device pixels — addressed by [#64](https://github.com/developmentseed/deck.gl-raster/issues/64)

`metersPerScreenPixel` is in *CSS* pixels. With deck.gl's default
`useDevicePixels: true`, the framebuffer has `devicePixelRatio` more
pixels per CSS pixel, each covering `1/dpr` of those meters. The
unfixed criterion under-resolves on HiDPI displays by `dpr`.

The fix renames the comparison to a dimensionless ratio:

```
devicePixelsPerSourcePixel = tileMetersPerPixel * pixelRatio
                             / metersPerCSSPixel
select if devicePixelsPerSourcePixel <= 1
```

The value is the on-screen size of one source pixel measured in
device pixels (units cancel to `device-pixel / source-pixel`). When it
is at most 1, a source pixel spans no more than a device pixel — the
source is at least as fine as the display can resolve.

The ratio is computed inline in the layer as
`drawingBufferWidth / cssWidth` (read off
`this.context.device.getDefaultCanvasContext()` per traversal) and
threaded through `getTileIndices` into the traversal params.

This is the **drawing-buffer ratio**, not the system DPR
(`window.devicePixelRatio` /
`canvasContext.getDevicePixelRatio()`). The two are equal under
`useDevicePixels: true` (deck.gl's default), and diverge when the
user sets:

- `useDevicePixels: false` → drawing buffer matches CSS, ratio = 1.
- `useDevicePixels: <number>` → explicit override.
- `setDrawingBufferSize()` called directly, or `maxDrawingBufferSize`
  capping a 4K canvas → drawing buffer smaller than the screen's
  physical pixels.

We use the drawing-buffer ratio because it reflects what deck.gl is
actually rendering to — which is the right thing for LOD to match.
The luma.gl maintainers deprecated `cssToDeviceRatio()` (which
historically returned this value) in part because the name conflated
"drawing buffer" with "device pixel"; computing
`drawingBufferWidth / cssWidth` explicitly avoids that ambiguity.
The variable names elsewhere in our code (`pixelRatio`,
`devicePixelsPerSourcePixel`) follow deck.gl's convention of using
"device pixel" colloquially to mean "rendered framebuffer pixel."

Behavior change: on a 2× display, ~4× more tiles fetched per view (one
finer overview level, four times the tile count over the same area).
That is the correct behavior under the device-pixel framing — the
display can resolve that detail.

### (B) Camera distance and tilt — accepted limitation

`getMetersPerPixel(lat, zoom)` is a top-down formula. Tilted views
exhibit perspective foreshortening: distant tiles cover fewer screen
pixels than near tiles at the same latitude, but our formula treats
them identically. The result is over-fetching distant tiles in heavily
tilted views.

Upstream OSM avoids this with `boundingVolume.distanceTo(cameraPosition)`,
which directly measures projected screen size in pixels. Folding this
into our criterion would require either restructuring the formula
around projected screen footprint (see (D)) or adding a
distance-to-camera correction term. We accept the limitation; impact
is mostly invisible for top-down imagery viewers.

### (C) Source-side latitude variation — accepted limitation, [#89](https://github.com/developmentseed/deck.gl-raster/issues/89)

`tileMetersPerPixel` is a single per-level value. For Web Mercator data
this is correct (see the "what it accounts for" section). For
*degree-based* CRSes — `WorldCRS84Quad` and similar — a degree of
longitude shrinks with latitude, so a single source pixel covers fewer
ground meters near the poles than at the equator. The constant
overstates resolution at high latitudes.

Source-pixel dimensions are also direction-dependent in degree CRSes:
east-west spans `cellSize · 111000 · cos(lat)` meters; north-south
spans `cellSize · 111000` meters. A truly correct criterion would
either pick the larger (conservative) dimension or compute a
geometric mean. We do neither; the criterion uses a single isotropic
value.

The fix would be a per-tile `metersPerPixel(tileCenter)` API on
`TilesetLevel`, not a per-level constant. We accept the limitation
because the affected use case — global degree-based source pyramids —
is not currently a priority.

### (D) A unifying alternative — possible future direction

The two acknowledged gaps (B and C) both stem from comparing
*ground-meters approximations* on each side. Both could be eliminated
by computing the criterion directly in screen pixels. Sketch:

```ts
// Project the tile's common-space corners through the viewport's
// viewProjectionMatrix and measure the on-screen footprint in CSS
// pixels.
const onScreen = projectTileToScreenAABB(tile, viewport);
const devicePixelsPerSourcePixel = pixelRatio * Math.max(
  onScreen.width  / tile.tileWidth,
  onScreen.height / tile.tileHeight,
);
selected = devicePixelsPerSourcePixel <= 1;
```

`viewport.viewProjectionMatrix` already has perspective, latitude
distortion, and source-to-screen projection baked in (it's the matrix
the GPU uses). The on-screen footprint emerges from it directly.
Subsumes:

- (B) — perspective is in the matrix; distant tiles project to fewer
  pixels.
- (C) — corners are projected from each tile's actual common-space
  position; whatever distortion the source uses is reflected in the
  footprint without any per-CRS code path.
- Globe view — same matrix, no special case needed.

Costs: a few extra mat4×vec4 multiplications per tile during traversal
(we already project corners for the bounding volume; reuse those
points). One real risk: tiles crossing the camera plane in heavily
tilted views can produce degenerate projections (`w ≤ 0`); needs
explicit handling.

We are not doing this now because the current criterion is correct in
the common cases (Mercator data on a Mercator screen, top-down or
moderately tilted) and (D) is a larger change than the audit pressure
warrants. The right time to revisit is when (a) tilt becomes important
to a user, or (b) degree-based or other non-Mercator source pyramids
become a supported scenario.

## Glossary

- **`tileMetersPerPixel`** — ground meters per source pixel for a
  given `TilesetLevel`. Per-level constant.
- **`metersPerScreenPixel`** / **`metersPerCSSPixel`** — ground meters
  per CSS pixel at the current viewport zoom and a given latitude.
- **`pixelRatio`** / **`cssToDeviceRatio`** — device pixels per CSS
  pixel; deck.gl's effective rendering ratio. Read from
  `device.canvasContext.cssToDeviceRatio()`.
- **`devicePixelsPerSourcePixel`** — the LOD criterion variable.
  On-screen size of one source pixel, measured in device pixels.
  Less than or equal to 1 means the source can fully resolve the
  rendered framebuffer.
- **`viewport.zoom`** — continuous zoom value on the active viewport.
  See [zoom-terminology.md](zoom-terminology.md).
- **`tile.z`** — tile pyramid level index (0 = coarsest in our
  descriptors). See [zoom-terminology.md](zoom-terminology.md).

## See also

- [zoom-terminology.md](zoom-terminology.md) — viewport zoom vs. tile
  z-index
- [raster-tile-traversal.ts](../packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts) — the LOD logic implementation
- Upstream `@deck.gl/geo-layers` `tile-2d-traversal.ts` for comparison
- Issues
  [#64](https://github.com/developmentseed/deck.gl-raster/issues/64),
  [#89](https://github.com/developmentseed/deck.gl-raster/issues/89)
