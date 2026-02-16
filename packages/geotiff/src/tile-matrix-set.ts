import type { Affine } from "@developmentseed/affine";
import * as affine from "@developmentseed/affine";
import type {
  BoundingBox,
  CRS,
  TileMatrix,
  TileMatrixSet,
} from "@developmentseed/morecantile";
import { metersPerUnit } from "@developmentseed/morecantile";
import { v4 as uuidv4 } from "uuid";
import type { ProjJson } from "./crs.js";
import type { GeoTIFF } from "./geotiff.js";

/**
 * A minimal projection definition compatible with what wkt-parser returns.
 *
 * This type extracts only the partial properties we need from the full
 * wkt-parser output.
 */
interface ProjectionDefinition {
  datum?: {
    /** Semi-major axis of the ellipsoid. */
    a: number;
  };
  a?: number;
  to_meter?: number;
  units?: string;
}

const SCREEN_PIXEL_SIZE = 0.28e-3;

function buildCrs(crs: number | ProjJson): CRS {
  if (typeof crs === "number") {
    return {
      uri: `http://www.opengis.net/def/crs/EPSG/0/${crs}`,
    };
  }

  // @ts-expect-error - typing issues between different projjson definitions.
  return {
    wkt: crs,
  };
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
 * This requires a crs definition that includes a `units` property, so that we
 * can convert pixel sizes to physical screen units. Use [`wkt-parser`] to parse
 * a WKT string or PROJJSON object, then pass the result as the `crs` argument.
 *
 * [`wkt-parser`]: https://github.com/proj4js/wkt-parser
 *
 * @see https://docs.ogc.org/is/17-083r4/17-083r4.html
 */
export function generateTileMatrixSet(
  geotiff: GeoTIFF,
  crs: ProjectionDefinition,
  { id = uuidv4() }: { id?: string } = {},
): TileMatrixSet {
  const bbox = geotiff.bbox;
  const tr = geotiff.transform;

  // Perhaps we should allow metersPerUnit to take any string
  const crsUnit = crs.units as
    | "m"
    | "metre"
    | "meter"
    | "meters"
    | "foot"
    | "us survey foot"
    | "degree"
    | undefined;

  if (!crsUnit) {
    throw new Error(`CRS definition must include "units" property`);
  }

  const semiMajorAxis = crs.a || crs.datum?.a;
  const mpu = metersPerUnit(crsUnit, { semiMajorAxis });
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

  const tmsCrs = buildCrs(geotiff.crs);
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
