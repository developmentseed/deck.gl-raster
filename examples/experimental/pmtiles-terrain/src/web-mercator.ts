import type { TileMatrixSet } from "@developmentseed/morecantile";

/** Radius of the Web Mercator sphere, in meters. */
export const EARTH_RADIUS = 6378137;

/** Half the width (and height) of the Web Mercator world, in meters. */
export const WORLD_HALF_SIZE = Math.PI * EARTH_RADIUS;

/**
 * Width of an OGC "standardized rendering pixel", in meters. A tile matrix's
 * `scaleDenominator` is its cell size divided by this.
 */
const STANDARD_PIXEL_SIZE = 0.00028;

/**
 * Width of one texel in projected Web Mercator meters at zoom `z`, for tiles
 * `tileSize` texels wide.
 *
 * This is the size on the projected plane. On the ground, a texel is
 * {@link groundCellSize} wide, which shrinks away from the equator.
 */
export function cellSize(z: number, tileSize: number): number {
  return (2 * WORLD_HALF_SIZE) / (tileSize * 2 ** z);
}

/**
 * The Web Mercator y of the north and south edges of tile row `y` at zoom
 * `z`, in meters. Rows count down from the north edge of the world.
 */
export function tileMercatorYRange(
  z: number,
  y: number,
): [north: number, south: number] {
  const rowHeight = (2 * WORLD_HALF_SIZE) / 2 ** z;
  return [
    WORLD_HALF_SIZE - y * rowHeight,
    WORLD_HALF_SIZE - (y + 1) * rowHeight,
  ];
}

/**
 * Width on the ground of a texel that is `cellSize` meters wide on the Web
 * Mercator plane, at Mercator y `mercatorY`.
 *
 * Mercator stretches distances by `1 / cos(latitude)` in both directions, so
 * the ground size is the projected size times `cos(latitude)`. The terrain
 * shader computes the same thing per fragment; this is its CPU twin.
 */
export function groundCellSize(cellSize: number, mercatorY: number): number {
  const latitude =
    2 * Math.atan(Math.exp(mercatorY / EARTH_RADIUS)) - Math.PI / 2;
  return cellSize * Math.cos(latitude);
}

/**
 * The OGC WebMercatorQuad tile matrix set with tiles `tileSize` texels wide,
 * with one tile matrix per zoom from 0 to `maxZoom`.
 *
 * morecantile ships no tile matrix set definitions, and PMTiles archives
 * address WebMercatorQuad tiles by z/x/y, so this builds one. With 512 px
 * tiles, zoom `z` has the cell size of the standard 256 px set's `z + 1`.
 */
export function webMercatorQuad(options: {
  tileSize: number;
  maxZoom: number;
}): TileMatrixSet {
  const { tileSize, maxZoom } = options;
  const tileMatrices = [];
  for (let z = 0; z <= maxZoom; z++) {
    const size = cellSize(z, tileSize);
    tileMatrices.push({
      id: String(z),
      scaleDenominator: size / STANDARD_PIXEL_SIZE,
      cellSize: size,
      cornerOfOrigin: "topLeft" as const,
      pointOfOrigin: [-WORLD_HALF_SIZE, WORLD_HALF_SIZE] as [number, number],
      tileWidth: tileSize,
      tileHeight: tileSize,
      matrixWidth: 2 ** z,
      matrixHeight: 2 ** z,
    });
  }
  return {
    id: "WebMercatorQuad",
    crs: "http://www.opengis.net/def/crs/EPSG/0/3857",
    orderedAxes: ["X", "Y"],
    tileMatrices,
  };
}
