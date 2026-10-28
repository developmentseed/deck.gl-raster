/**
 * Assembly of a one-texel "halo" around a tile's elevation.
 *
 * Hillshade needs a 3 x 3 neighborhood per pixel, but a tile's texture holds
 * only that tile's texels. At the tile border the +/-1 tap falls outside the
 * texture and `CLAMP_TO_EDGE` returns the border texel itself, halving the
 * computed gradient: a visible seam along every tile boundary.
 *
 * The fix is a `(tileSize + 2) x (tileSize + 2)` texture whose outermost ring
 * is copied from the eight neighboring tiles. The ring needs only each
 * neighbor's outermost rows and columns, its {@link TileBorder}, so that is all
 * a cache has to keep.
 */
import { CENTER_INDEX } from "./neighbors.js";

/**
 * The outermost texels of a square tile, each `tileSize` long: its first row,
 * last row, first column and last column, in reading order.
 */
export type TileBorder = {
  top: Float32Array;
  bottom: Float32Array;
  left: Float32Array;
  right: Float32Array;
};

/**
 * The one-texel ring around a tile. `top` and `bottom` are `tileSize + 2`
 * long and include the corners; `left` and `right` are `tileSize` long.
 */
export type HaloRing = {
  top: Float32Array;
  bottom: Float32Array;
  left: Float32Array;
  right: Float32Array;
};

/** One `texture.writeData` call: a rectangle of the halo texture. */
export type RingWrite = {
  data: Float32Array;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Throw unless `array` holds `expected` values. */
function checkLength(
  array: Float32Array,
  expected: number,
  what: string,
): void {
  if (array.length !== expected) {
    throw new Error(`${what} has length ${array.length}, expected ${expected}`);
  }
}

/** Throw unless every side of `border` holds `tileSize` values. */
function checkBorder(border: TileBorder, tileSize: number, what: string): void {
  for (const [side, values] of Object.entries(border)) {
    checkLength(values, tileSize, `${what} (${side})`);
  }
}

/**
 * The border of a `tileSize x tileSize` tile of row-major elevations.
 */
export function extractBorder(
  elevation: Float32Array,
  tileSize: number,
): TileBorder {
  checkLength(elevation, tileSize * tileSize, "The elevation");
  const left = new Float32Array(tileSize);
  const right = new Float32Array(tileSize);
  for (let row = 0; row < tileSize; row++) {
    left[row] = elevation[row * tileSize]!;
    right[row] = elevation[row * tileSize + tileSize - 1]!;
  }
  return {
    top: elevation.slice(0, tileSize),
    bottom: elevation.slice((tileSize - 1) * tileSize),
    left,
    right,
  };
}

/** Options for {@link buildRing}. */
export interface BuildRingOptions {
  /** The border of the tile the ring surrounds. */
  center: TileBorder;
  /**
   * Borders of the 3 x 3 block in `neighborIndices` order. The center's slot
   * is ignored. A `null` or `undefined` neighbor (none there, or not arrived
   * yet) is replaced by the center tile's own edge, as `gdaldem` does at a
   * raster's edge.
   */
  neighbors: ReadonlyArray<TileBorder | null | undefined>;
  /** Width and height of a tile, in texels. */
  tileSize: number;
}

/**
 * The ring around a tile: each texel is the nearest texel of the neighbor in
 * its direction. The north side is the north neighbor's bottom row, a corner
 * is the diagonal neighbor's nearest corner, and so on.
 *
 * @throws If a border isn't `tileSize` long.
 */
export function buildRing(options: BuildRingOptions): HaloRing {
  const { center, neighbors, tileSize } = options;
  const last = tileSize - 1;
  checkBorder(center, tileSize, "The center's border");
  for (const [i, border] of neighbors.entries()) {
    if (border && i !== CENTER_INDEX) {
      checkBorder(border, tileSize, `Neighbor ${i}'s border`);
    }
  }

  const [nw, n, ne, w, , e, sw, s, se] = neighbors;
  const top = new Float32Array(tileSize + 2);
  top[0] = nw ? nw.bottom[last]! : center.top[0]!;
  top.set(n ? n.bottom : center.top, 1);
  top[tileSize + 1] = ne ? ne.bottom[0]! : center.top[last]!;

  const bottom = new Float32Array(tileSize + 2);
  bottom[0] = sw ? sw.top[last]! : center.bottom[0]!;
  bottom.set(s ? s.top : center.bottom, 1);
  bottom[tileSize + 1] = se ? se.top[0]! : center.bottom[last]!;

  return {
    top,
    bottom,
    left: (w ? w.right : center.left).slice(),
    right: (e ? e.left : center.right).slice(),
  };
}

/** Options for {@link buildHaloArray}. */
export interface BuildHaloArrayOptions {
  /** The tile's `tileSize x tileSize` elevations, row-major. */
  elevation: Float32Array;
  /** The ring around it, from {@link buildRing}. */
  ring: HaloRing;
  /** Width and height of a tile, in texels. */
  tileSize: number;
}

/**
 * A `(tileSize + 2) x (tileSize + 2)` array, row-major: the tile inset by one
 * texel, inside its ring.
 *
 * @throws If the elevation isn't `tileSize x tileSize`.
 */
export function buildHaloArray(options: BuildHaloArrayOptions): Float32Array {
  const { elevation, ring, tileSize } = options;
  checkLength(elevation, tileSize * tileSize, "The elevation");
  const width = tileSize + 2;
  const out = new Float32Array(width * width);
  out.set(ring.top, 0);
  for (let row = 0; row < tileSize; row++) {
    const start = (row + 1) * width;
    out[start] = ring.left[row]!;
    out.set(
      elevation.subarray(row * tileSize, (row + 1) * tileSize),
      start + 1,
    );
    out[start + width - 1] = ring.right[row]!;
  }
  out.set(ring.bottom, (width - 1) * width);
  return out;
}

/**
 * The four `texture.writeData` rectangles that replace a halo texture's
 * ring, leaving the tile inside it untouched: the top and bottom rows, then
 * the left and right columns between them.
 */
export function ringWrites(ring: HaloRing, tileSize: number): RingWrite[] {
  const width = tileSize + 2;
  return [
    { data: ring.top, x: 0, y: 0, width, height: 1 },
    { data: ring.bottom, x: 0, y: tileSize + 1, width, height: 1 },
    { data: ring.left, x: 0, y: 1, width: 1, height: tileSize },
    { data: ring.right, x: tileSize + 1, y: 1, width: 1, height: tileSize },
  ];
}
