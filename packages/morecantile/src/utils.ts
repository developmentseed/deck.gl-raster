import type { TileMatrix, TileMatrixSet } from "./types";

export function narrowTileMatrixSet(
  obj: TileMatrix | TileMatrixSet,
): obj is TileMatrixSet {
  return "tileMatrices" in obj;
}
