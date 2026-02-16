import type { Affine } from "@developmentseed/affine";
import * as affine from "@developmentseed/affine";
import type {
  BoundingBox,
  TileMatrix,
  TileMatrixSet,
} from "@developmentseed/morecantile";
import { metersPerUnit } from "@developmentseed/morecantile";
import { v4 as uuidv4 } from "uuid";
import type { GeoTIFF } from "./geotiff.js";

const SCREEN_PIXEL_SIZE = 0.28e-3;

/**
 * Derive the CRS unit string for metersPerUnit from an EPSG CRS string.
 *
 * Geographic CRS (lat/lon) use degrees; projected CRS use metres.
 * We use a simple heuristic: well-known geographic EPSG codes (4326, 4269,
 * 4267, 4258, …) are treated as degrees; everything else is assumed metres.
 */
function crsUnit(crs: string): "m" | "degree" {
  const geographicEpsg = new Set([4326, 4269, 4267, 4258, 4230, 4019]);
  const match = crs.match(/^EPSG:(\d+)$/i);
  if (match) {
    const code = parseInt(match[1]!, 10);
    if (geographicEpsg.has(code)) return "degree";
  }
  return "m";
}

/**
 * Build a TileMatrix entry for a single resolution level.
 */
function buildTileMatrix(
  id: string,
  transform: Affine,
  mpu: number,
  cornerOfOrigin: "bottomLeft" | "topLeft",
  tileWidth: number,
  tileHeight: number,
  width: number,
  height: number,
): TileMatrix {
  return {
    id,
    scaleDenominator: (affine.a(transform) * mpu) / SCREEN_PIXEL_SIZE,
    cellSize: affine.a(transform),
    cornerOfOrigin,
    pointOfOrigin: [affine.c(transform), affine.f(transform)],
    tileWidth,
    tileHeight,
    matrixWidth: Math.ceil(width / tileWidth),
    matrixHeight: Math.ceil(height / tileHeight),
  };
}

/**
 * Generate a Tile Matrix Set from a GeoTIFF file.
 *
 * Produces one TileMatrix per overview (coarsest first) plus a final entry
 * for the full-resolution level. The GeoTIFF must be tiled.
 *
 * @see https://docs.ogc.org/is/17-083r4/17-083r4.html
 */
export function generateTileMatrixSet(
  geotiff: GeoTIFF,
  { id = uuidv4() }: { id?: string } = {},
): TileMatrixSet {
  const bbox = geotiff.bbox;
  const crs = geotiff.crs;
  const tr = geotiff.transform;

  const mpu = metersPerUnit(crsUnit(crs), {});
  const cornerOfOrigin: "bottomLeft" | "topLeft" =
    affine.e(tr) > 0 ? "bottomLeft" : "topLeft";

  const tileMatrices: TileMatrix[] = [];

  // Overviews are sorted finest-to-coarsest; reverse to emit coarsest first.
  const overviewsCoarseFirst = [...geotiff.overviews].reverse();

  for (let idx = 0; idx < overviewsCoarseFirst.length; idx++) {
    const overview = overviewsCoarseFirst[idx]!;
    tileMatrices.push(
      buildTileMatrix(
        String(idx),
        overview.transform,
        mpu,
        cornerOfOrigin,
        overview.tileWidth,
        overview.tileHeight,
        overview.width,
        overview.height,
      ),
    );
  }

  // Full-resolution level is appended last.
  if (!geotiff.isTiled) {
    throw new Error("GeoTIFF must be tiled to generate a TMS.");
  }

  tileMatrices.push(
    buildTileMatrix(
      String(geotiff.overviews.length),
      tr,
      mpu,
      cornerOfOrigin,
      geotiff.tileWidth,
      geotiff.tileHeight,
      geotiff.width,
      geotiff.height,
    ),
  );

  const tmsCrs = crs;
  const boundingBox: BoundingBox = {
    lowerLeft: [bbox[0], bbox[1]],
    upperRight: [bbox[2], bbox[3]],
    crs: tmsCrs,
  };

  return {
    title: "Generated TMS",
    id,
    crs: tmsCrs,
    boundingBox,
    tileMatrices,
  };
}
