import type { RasterTilesetLevel } from "@developmentseed/deck.gl-raster";

/**
 * One tile's outline, in UTM metres, from the level's `projectedTileCorners`
 * (clipped to the image in the last column and row).
 */
export function tileRing(
  level: RasterTilesetLevel,
  col: number,
  row: number,
): [number, number][] {
  const corners = level.projectedTileCorners(col, row);
  return [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];
}

/** Every tile's outline in a level, row by row. */
export function gridRings(level: RasterTilesetLevel): [number, number][][] {
  const rings: [number, number][][] = [];
  for (let row = 0; row < level.matrixHeight; row++) {
    for (let col = 0; col < level.matrixWidth; col++) {
      rings.push(tileRing(level, col, row));
    }
  }
  return rings;
}
