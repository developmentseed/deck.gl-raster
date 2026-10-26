// The projection setup shared by COGSource and MultiCOGSource

import type { ProjectionFunction } from "@developmentseed/deck.gl-raster";
import type { GeoTIFF } from "@developmentseed/geotiff";
import type { EpsgResolver, ProjectionDefinition } from "@developmentseed/proj";
import {
  makeClampedForwardTo3857,
  metersPerUnit,
  parseWkt,
} from "@developmentseed/proj";
import type { Converter } from "proj4";
import proj4 from "proj4";

/**
 * Resolve a GeoTIFF's `crs`: an EPSG code through `epsgResolver`, and WKT or
 * PROJJSON with `parseWkt`.
 */
export async function resolveProjection(
  crs: GeoTIFF["crs"],
  epsgResolver: EpsgResolver,
): Promise<ProjectionDefinition> {
  return typeof crs === "number" ? await epsgResolver(crs) : parseWkt(crs);
}

/**
 * The functions that project between a CRS and WGS84 or Web Mercator, and the
 * CRS's meters per unit.
 */
export function projectionFunctions(projection: ProjectionDefinition): {
  /** proj4's converter to WGS84, as `getGeographicBounds` takes it. */
  converter4326: Converter;
  projectTo4326: ProjectionFunction;
  projectFrom4326: ProjectionFunction;
  projectTo3857: ProjectionFunction;
  projectFrom3857: ProjectionFunction;
  /** Meters per unit of the CRS. */
  mpu: number;
} {
  // @ts-expect-error - proj4 typings are incomplete and don't support
  // wkt-parser input
  const converter4326 = proj4(projection, "EPSG:4326");
  const projectTo4326 = (x: number, y: number) =>
    converter4326.forward<[number, number]>([x, y], false);
  const projectFrom4326 = (x: number, y: number) =>
    converter4326.inverse<[number, number]>([x, y], false);

  // @ts-expect-error - proj4 typings are incomplete and don't support
  // wkt-parser input
  const converter3857 = proj4(projection, "EPSG:3857");
  const projectTo3857 = makeClampedForwardTo3857(
    (x: number, y: number) =>
      converter3857.forward<[number, number]>([x, y], false),
    projectTo4326,
  );
  const projectFrom3857 = (x: number, y: number) =>
    converter3857.inverse<[number, number]>([x, y], false);

  const units = projection.units;
  if (!units) {
    throw new Error(
      "Source projection is missing 'units' property, cannot compute meters per unit",
    );
  }
  const mpu = metersPerUnit(units as Parameters<typeof metersPerUnit>[0], {
    semiMajorAxis: projection.datum?.a ?? projection.a,
  });

  return {
    converter4326,
    projectTo4326,
    projectFrom4326,
    projectTo3857,
    projectFrom3857,
    mpu,
  };
}
