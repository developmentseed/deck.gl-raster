# Can the GeoJSON west>east convention replace the `x < 256` heuristic?

## Background

`unwrapCommonSpaceX` (`packages/deck.gl-raster/src/raster-tileset/antimeridian-cut.ts`) corrects
one reprojected reference point's common-space `x` for an antimeridian-crossing tile:

```ts
export function unwrapCommonSpaceX(x: number, tileSize: number): number {
  return x < tileSize / 2 ? x + tileSize : x;
}
```

This is used both by the traversal's bounding-volume fit (`raster-tile-traversal.ts`) and, mirrored
per piece, by `buildPieceReprojection` (`raster-tileset-2d.ts`) to place each piece's mesh vertices.
It's a **midpoint test**: `tileSize/2` (256, in common-space units) is the threshold. It works for a
normal, narrow tile — but it's a heuristic, not a proof, and it has a real failure mode: a piece
wide enough that its own legitimate points cross the 256 line without ever having wrapped around the
antimeridian at all.

Elsewhere in this codebase, antimeridian-crossing detection avoids exactly this kind of magnitude
guess by using the GeoJSON bbox convention (RFC 7946 §5.2: `minX > maxX` marks a crossing bbox) —
`unwrapEastLng` and `normalizeSourceBbox`, described below. Given that convention already solves a
structurally similar problem cleanly, this doc asks: can it replace `unwrapCommonSpaceX` too?

**Short answer: no — not because the convention is wrong, but because the two problems aren't the
same shape.** Detection and per-point placement hit fundamentally different constraints. This doc
works through why, then documents the width guard that was added instead.

## Where the GeoJSON convention is already used (and why it works there)

- **`unwrapEastLng(westLng, eastLng)`** (`antimeridian-cut.ts`): the literal GeoJSON idiom — if
  `eastLng < westLng`, add 360°. Used by `edgeUCut`/`antimeridianCut` to detect whether a tile's
  corners cross the seam and to locate the cut (`uCut`).
- **`normalizeSourceBbox`** (`packages/deck.gl-geotiff/src/mosaic-layer/mosaic-layer.ts`): the same
  idiom applied to a `MosaicLayer` source's bbox before it's indexed into Flatbush.

Both are **corner/bbox-level, one-shot, detection-time** uses: given exactly two known longitudes
(west corner, east corner), decide "does this cross, and if so, where." That's a single yes/no
comparison between two known values — it doesn't care how wide the span between them is. A dataset
whose bbox is 300° wide is detected exactly as reliably as one that's 3° wide, because there's
nothing here to disambiguate — the two corners are given directly, not derived by guessing which
"copy" of a periodic function they came from.

`unwrapCommonSpaceX`'s job is different: given a single **already-wrapped** output value (a mesh
vertex's `x`, after it's been through a proj4 forward projection that only ever returns something in
`(−180°, 180°]`), decide how many multiples of 360° it's actually offset by. That's not a two-value
comparison — it's recovering information that's already been thrown away by the projection.

## Trying the "obvious" fix: make the reference explicit and piece-relative

The first instinct is: instead of a hardcoded `tileSize/2`, compare each point against its own
piece's *known* reference corner — the same "compare against a trusted value" idiom `unwrapEastLng`
uses, instead of a magic constant.

Concretely: west piece's own seam-adjacent corner is always expected at common-space `x = tileSize`
(512); east piece's at `x = 0`. Write the correction as reference-relative:

```ts
function unwrap(x, reference, worldWidth) {
  let corrected = x;
  while (corrected - reference > worldWidth / 2) corrected -= worldWidth;
  while (corrected - reference < -worldWidth / 2) corrected += worldWidth;
  return corrected;
}
```

For the west piece, `reference = 512`: `x - 512 < -256` ⟺ `x < 256` → add 512. **Identical to the
current test.** For the east piece, `reference = 0`: `x - 0 > 256` ⟺ `x >= 256` → subtract 512.
**Also identical.**

This isn't a coincidence to be engineered around — it's forced. For this exact geometry (a tile cut
into precisely two pieces, both anchored at the seam), the *only* legitimate reference for each
piece is 0 or 512 — both of which are literally the antimeridian, just viewed from each piece's own
frame. Their arithmetic midpoint is unavoidably 256. Reframing the test as "reference-relative"
doesn't change what reference to use, because there was never a real choice of reference to make.
**No improvement available here.**

## Trying to move the correction earlier: unwrap in longitude space, not common space

Second instinct: EPSG:3857's `x` is *exactly linear* in longitude (`x = R · radians(lng)`, no
trigonometry, unlike the `y` axis) — so what if the wrap correction happened on the longitude
*before* that linear step, using the same `unwrapEastLng`-style "compare against the piece's known
reference longitude" logic, instead of correcting the already-rescaled common-space output?

This felt promising enough in the first pass of reasoning through it to conclude it might extend the
safe range all the way to just under 360° per piece. That conclusion was **wrong**, and the mistake
is worth keeping visible rather than editing out, because it's the natural way to talk yourself into
believing this direction works:

- The error was measuring the safe window as "±180° around the reference" and calling that the
  piece's *width budget* — i.e. up to 360° total, 180° in each direction.
- But the reference longitude is the piece's own **seam corner** — one *edge* of the piece, not its
  center. The piece only extends *away* from that edge in one direction. So the usable budget is the
  distance from the reference to the piece's *far* corner in that single direction — which is capped
  at just under 180°, not 360°, before you reach the reference's own antipode and the same ambiguity
  reappears.

Redone correctly: doing the correction in longitude-space before the linear rescale hits the
**exact same ±180°-per-piece limit** as doing it in common-space after. Moving where the correction
happens doesn't change how much information was lost — the projection is periodic with period 360°
regardless of which side of the linear rescale you sit on, and no single-reference comparison can
resolve an ambiguity wider than half that period. **No improvement here either.**

## The actual limit, stated plainly

Any point-independent correction anchored to a single reference — whether phrased as "is `x`
past the midpoint," "is `x` more than half a world from this piece's known corner," or "is this
point's longitude more than 180° from the seam" — is the same test under different names, and none
of them can disambiguate a 360°-periodic signal beyond **±180° from the reference**. This is a
property of the math (Nyquist-style: you cannot recover a signal's true phase from a wrapped sample
that's more than half a period from your only reference point), not a gap in how cleverly the
formula is written. `unwrapCommonSpaceX`'s width limit was never really "assumes points don't
wander past Greenwich" (256 only numerically coincides with the prime meridian) — it's "assumes each
piece is under ~180° wide," which is the actual, unavoidable constraint on this entire class of
correction.

**What would genuinely raise the limit**: true neighbor-relative phase unwrapping — walk a piece's
sample points in spatial order and accumulate a running ±360° offset whenever adjacent samples jump
by more than half a period. This is the only way to legitimately handle a piece approaching 360°
wide. It's also exactly the family of fix the antimeridian design doc already tried and explicitly
rejected (PR #374, "sank" — see `dev-docs/specs/2026-05-27-antimeridian-crossing-tile-design.md`,
"Why not render-as-one"), and it doesn't fit this codebase's current sampling architecture (each of
the 9 reference points / mesh vertices is computed independently, with no defined spatial adjacency
or traversal order to accumulate along). Reintroducing it here would be resurrecting a
previously-rejected approach for a risk that has a much cheaper fix available — see below.

## The width guard (implemented)

Since no formula closes the gap, the fix is to detect when a piece would exceed the safe range and
refuse to cut it — the same way an unsupported slanted or curved cut is already refused, rather than
silently producing a torn mesh.

**`antimeridianCut`** (`antimeridian-cut.ts`) now computes each piece's angular span from the same
unwrapped corner longitudes already used for cut detection — no new data needed:

```ts
const MAX_PIECE_SPAN_DEG = 170;

// ...after computing uCut from the top/bottom edge crossings:
const totalSpanDeg = unwrapEastLng(topLeft, topRight) - topLeft;
const westPieceSpanDeg = uCut * totalSpanDeg;
const eastPieceSpanDeg = totalSpanDeg - westPieceSpanDeg;
if (
  westPieceSpanDeg >= MAX_PIECE_SPAN_DEG ||
  eastPieceSpanDeg >= MAX_PIECE_SPAN_DEG
) {
  return undefined;
}
```

`170` rather than the mathematical limit of `180` leaves margin against floating-point noise right
at the boundary. Returning `undefined` reuses the exact fallback path a curved or slanted cut
already takes: the caller renders the tile as a single full mesh instead of splitting it — not a
new failure mode, the same one #366 already documented for wide/global tiles, just reached
deliberately instead of by silent corruption.

Covered by tests in `antimeridian-cut.test.ts`: a piece just under the threshold still cuts
normally, and a piece at or over it returns `undefined` instead of a cut.

## Limitations (explicit)

- **The guard doesn't fix wide tiles — it stops them from being silently wrong.** A rejected
  crossing tile falls back to a single full mesh, which can still hit the original #366 divergence
  (`RasterReprojector` failing to converge) for a genuinely wide/global tile. That's a pre-existing,
  documented limitation of the render-as-one fallback, not something this guard solves.
- **No per-point or per-piece formula can raise the 170°/180° limit.** Every variant considered
  above — common-space, reference-relative, longitude-space — is the same test in different clothes.
  Only neighbor-relative phase unwrapping could, and that's already-rejected territory (#374).
- **Practical exposure is low for normally-tiled data.** A single OGC/zarr tile — including the
  PDC/EPSG:3832 data this PR targets — is almost always a small fraction of the globe. The real risk
  is concentrated in coarse `z=0` root tiles of lightly-tiled global datasets (the codebase already
  has special-casing elsewhere for datasets with very few root tiles, e.g. `MAX_ROOT_TILES_NO_CULL`
  in `raster-tile-traversal.ts`) — worth checking if any real dataset's coarsest level can actually
  produce a piece this wide, but not an urgent risk for typically-tiled sources.

## Conclusion

The GeoJSON west>east convention is already doing the right job everywhere it's used —
`unwrapEastLng`/`antimeridianCut` for cut detection, `normalizeSourceBbox` for Mosaic source
indexing — and neither needs replacing. It does not generalize into a fix for
`unwrapCommonSpaceX`'s per-point placement correction: reframed as reference-relative, it's
arithmetically identical to what's already shipped; moved into longitude-space, it hits the same
±180°-per-piece wall under a different name. The width guard added to `antimeridianCut` — reject and
fall back, not a smarter formula — is the right-sized fix for the actual risk.
