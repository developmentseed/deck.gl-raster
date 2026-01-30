/**
 * Reprojection utilities for Zarr arrays.
 *
 * Adapted from deck.gl-geotiff/src/geotiff-reprojection.ts
 */

import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import {
  applyAffine,
  invertGeoTransform,
} from "@developmentseed/raster-reproject/affine";
import type { ProjectionDefinition } from "proj4";
import proj4 from "proj4";
import type { PROJJSONDefinition } from "proj4/dist/lib/core";

// Register EPSG:3857 (Web Mercator) - not included in proj4 by default
proj4.defs(
  "EPSG:3857",
  "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs",
);

/**
 * WGS84 (CRS84) PROJJSON definition
 */
export const OGC_84: PROJJSONDefinition = {
  $schema: "https://proj.org/schemas/v0.7/projjson.schema.json",
  type: "GeographicCRS",
  name: "WGS 84 (CRS84)",
  datum_ensemble: {
    name: "World Geodetic System 1984 ensemble",
    members: [
      {
        name: "World Geodetic System 1984 (Transit)",
        id: { authority: "EPSG", code: 1166 },
      },
      {
        name: "World Geodetic System 1984 (G730)",
        id: { authority: "EPSG", code: 1152 },
      },
      {
        name: "World Geodetic System 1984 (G873)",
        id: { authority: "EPSG", code: 1153 },
      },
      {
        name: "World Geodetic System 1984 (G1150)",
        id: { authority: "EPSG", code: 1154 },
      },
      {
        name: "World Geodetic System 1984 (G1674)",
        id: { authority: "EPSG", code: 1155 },
      },
      {
        name: "World Geodetic System 1984 (G1762)",
        id: { authority: "EPSG", code: 1156 },
      },
      {
        name: "World Geodetic System 1984 (G2139)",
        id: { authority: "EPSG", code: 1309 },
      },
    ],
    ellipsoid: {
      name: "WGS 84",
      semi_major_axis: 6378137,
      inverse_flattening: 298.257223563,
    },
    accuracy: "2.0",
    id: { authority: "EPSG", code: 6326 },
  },
  coordinate_system: {
    subtype: "ellipsoidal",
    axis: [
      {
        name: "Geodetic longitude",
        abbreviation: "Lon",
        direction: "east",
        unit: "degree",
      },
      {
        name: "Geodetic latitude",
        abbreviation: "Lat",
        direction: "north",
        unit: "degree",
      },
    ],
  },
  scope: "Not known.",
  area: "World.",
  bbox: {
    south_latitude: -90,
    west_longitude: -180,
    north_latitude: 90,
    east_longitude: 180,
  },
  // @ts-expect-error - proj4 types are incomplete
  id: { authority: "OGC", code: "CRS84" },
};

/**
 * Create forward and inverse transform functions from an affine geotransform.
 *
 * @param geotransform 6-element affine in Python affine ordering [a, b, c, d, e, f]
 *   where: x_geo = a*col + b*row + c, y_geo = d*col + e*row + f
 */
export function fromGeoTransform(
  geotransform: [number, number, number, number, number, number],
): {
  forwardTransform: (x: number, y: number) => [number, number];
  inverseTransform: (x: number, y: number) => [number, number];
} {
  const inverseGeotransform = invertGeoTransform(geotransform);
  return {
    forwardTransform: (x: number, y: number) => applyAffine(x, y, geotransform),
    inverseTransform: (x: number, y: number) =>
      applyAffine(x, y, inverseGeotransform),
  };
}

/**
 * Create reprojection functions from a source CRS.
 *
 * @param sourceProjection Source CRS definition (proj4 string or PROJJSON)
 * @param outputCrs Output CRS. Defaults to OGC_84 (WGS84) for deck.gl rendering.
 *   For EPSG:4326/3857 source data, GPU reprojection is used instead of mesh refinement.
 */
export function createReprojectionFns(
  sourceProjection: string | PROJJSONDefinition,
  outputCrs: string | PROJJSONDefinition = OGC_84,
): {
  forwardReproject: ReprojectionFns["forwardReproject"];
  inverseReproject: ReprojectionFns["inverseReproject"];
} {
  const converter = proj4(sourceProjection, outputCrs);

  return {
    forwardReproject: (x: number, y: number) =>
      converter.forward<[number, number]>([x, y], false),
    inverseReproject: (x: number, y: number) =>
      converter.inverse<[number, number]>([x, y], false),
  };
}

/**
 * Parse a proj4-accepted input into a ProjectionDefinition
 */
export function parseCrs(
  crs: string | PROJJSONDefinition,
): ProjectionDefinition {
  // If you pass proj4.defs a projjson, it doesn't parse it; it just returns the
  // input.
  //
  // Instead, you need to assign it to an alias and then retrieve it.

  const key = "__deck.gl-zarr-internal__";
  proj4.defs(key, crs);
  return proj4.defs(key);
}

/**
 * Compute geotransform from bounds, shape, and lat orientation.
 *
 * @param bounds [xMin, yMin, xMax, yMax] in CRS units
 * @param shape [height, width] or full shape array with spatial dims last
 * @param latIsAscending Whether row 0 is south (true) or north (false)
 * @param spatialDimIndices Indices of Y and X dimensions in shape array
 */
export function computeGeotransformFromBounds(
  bounds: [number, number, number, number],
  shape: number[],
  latIsAscending: boolean,
  spatialDimIndices: { x: number | null; y: number | null },
): [number, number, number, number, number, number] {
  const [xMin, yMin, xMax, yMax] = bounds;

  // Get spatial dimensions from shape
  const xDimIndex = spatialDimIndices.x ?? shape.length - 1;
  const yDimIndex = spatialDimIndices.y ?? shape.length - 2;
  const width = shape[xDimIndex]!;
  const height = shape[yDimIndex]!;

  const pixelWidth = (xMax - xMin) / width;
  const pixelHeight = (yMax - yMin) / height;

  if (latIsAscending) {
    // Row 0 = south (y increases from bottom to top)
    // y_geo = pixelHeight * row + yMin
    return [pixelWidth, 0, xMin, 0, pixelHeight, yMin];
  } else {
    // Row 0 = north (y decreases from top to bottom, standard image convention)
    // y_geo = -pixelHeight * row + yMax
    return [pixelWidth, 0, xMin, 0, -pixelHeight, yMax];
  }
}
