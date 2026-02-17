import type {
  BoundingBox,
  TileMatrix,
  TileMatrixSet,
} from "@developmentseed/morecantile";
import { metersPerUnit } from "@developmentseed/morecantile";
import type { GeoTIFF, GeoTIFFImage } from "geotiff";
import proj4, { type ProjectionDefinition } from "proj4";
import { extractGeotransform } from "./geotiff-reprojection";
import type { GeoKeysParser, ProjectionInfo, SupportedCrsUnit } from "./proj";

function computeWgs84BoundingBox(
  boundingBox: BoundingBox,
  projectToWgs84: (point: [number, number]) => [number, number],
): BoundingBox {
  const lowerLeftWgs84 = projectToWgs84(boundingBox.lowerLeft);
  const lowerRightWgs84 = projectToWgs84([
    boundingBox.upperRight[0],
    boundingBox.lowerLeft[1],
  ]);
  const upperRightWgs84 = projectToWgs84(boundingBox.upperRight);
  const upperLeftWgs84 = projectToWgs84([
    boundingBox.lowerLeft[0],
    boundingBox.upperRight[1],
  ]);

  // Compute min/max lat/lon
  const minLon = Math.min(
    lowerLeftWgs84[0],
    lowerRightWgs84[0],
    upperRightWgs84[0],
    upperLeftWgs84[0],
  );
  const maxLon = Math.max(
    lowerLeftWgs84[0],
    lowerRightWgs84[0],
    upperRightWgs84[0],
    upperLeftWgs84[0],
  );
  const minLat = Math.min(
    lowerLeftWgs84[1],
    lowerRightWgs84[1],
    upperRightWgs84[1],
    upperLeftWgs84[1],
  );
  const maxLat = Math.max(
    lowerLeftWgs84[1],
    lowerRightWgs84[1],
    upperRightWgs84[1],
    upperLeftWgs84[1],
  );

  return {
    lowerLeft: [minLon, minLat],
    upperRight: [maxLon, maxLat],
  };
}
