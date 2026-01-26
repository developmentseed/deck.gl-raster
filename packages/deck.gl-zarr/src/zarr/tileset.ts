/**
 * Parse Zarr metadata to create a TileMatrixSet.
 *
 * Note that our TileMatrixSet is similar to but not exactly the same as the OGC
 * TileMatrixSet specification.
 */

import type {
  TileMatrix,
  TileMatrixSet,
} from "@developmentseed/deck.gl-raster";
import type { ZarrMetadataV2, ZarrMetadataV3 } from "./types";

export async function createZarrTileMatrixSet(
  metadata: ZarrMetadataV2 | ZarrMetadataV3,
): Promise<TileMatrixSet> {
  // For now we assume non-multiscale Zarr, so we only have a single TileMatrix
  const tileMatrix: TileMatrix = {
    id: "0",
  };
  const tileMatrixSet: TileMatrixSet = {
    crs: "EPSG:4326",
    tileMatrices: [tileMatrix],
    // Assuming that we're already in wgs84
    projectToWgs84: (point: [number, number]) => point,
  };
  return tileMatrixSet;
}

const WGS84_SEMI_MAJOR_AXIS = 6378137;

function metersPerUnit(): number {
  // 2 * π * ellipsoid semi-major-axis / 360
  return (2 * Math.PI * WGS84_SEMI_MAJOR_AXIS) / 360;
}
