import type { TileMatrix, TileMatrixSet } from "./types/index.js";

export function narrowTileMatrixSet(
  obj: TileMatrix | TileMatrixSet,
): obj is TileMatrixSet {
  return "tileMatrices" in obj;
}
