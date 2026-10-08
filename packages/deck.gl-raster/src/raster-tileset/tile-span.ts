/**
 * How close, as a fraction of a tile, a bound must be to a tile edge to count
 * as lying on it.
 *
 * In an aligned pyramid (WebMercatorQuad, or COG overviews that exactly halve)
 * each parent tile edge falls on a child tile edge, but the CRS arithmetic
 * that computes it can land a few 1e-9 of a tile to either side. 1e-6 of a
 * tile is well above that error and well below a pixel.
 *
 * This does not absorb cellSizes that a TileMatrixSet rounds to a few
 * significant digits (the OGC CDB1GlobalGrid example lists 2^-14 as
 * 6.10351562e-05). Such levels drift apart in proportion to the column index,
 * so far enough from the origin a parent again overlaps its neighbor's
 * children.
 */
const TILE_EDGE_TOLERANCE = 1e-6;

/**
 * Find the tiles that a span overlaps along one axis of a tile grid.
 *
 * `start` and `end` are positions in tile units from the grid origin, so tile
 * `i` spans `i` to `i + 1`. Tiles that the span only touches at an edge are
 * excluded: a parent whose edges sit on child tile edges overlaps exactly the
 * children it contains, not the neighbors that share those edges.
 *
 * @param start  Start of the span, in tiles from the grid origin.
 * @param end    End of the span, in tiles from the grid origin. Must not be
 *               less than `start`.
 * @returns The inclusive, unclamped index range `[first, last]`. A span
 *          narrower than the tolerance still returns one tile.
 */
export function overlappingTileSpan(
  start: number,
  end: number,
): [first: number, last: number] {
  const first = Math.floor(start + TILE_EDGE_TOLERANCE);
  const last = Math.ceil(end - TILE_EDGE_TOLERANCE) - 1;
  return [first, Math.max(first, last)];
}
