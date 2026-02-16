import * as affine from "@developmentseed/affine";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import { metersPerUnit } from "@developmentseed/morecantile";
import type { GeoTIFF } from "./geotiff";

export function generateTileMatrixSet(geotiff: GeoTIFF): TileMatrixSet {
  const bounds = geotiff.bbox;
  const crs = geotiff.crs;
  const transform = geotiff.transform;

  const mpu = metersPerUnit("m", {});
  const cornerOfOrigin = affine.e(transform) > 0 ? "bottomLeft" : "topLeft";
}
