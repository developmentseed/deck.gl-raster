import proj4 from "proj4";
import { metersPerUnit } from "./meters-per-unit.js";
import type { ProjectionDefinition } from "./parse-wkt.js";
import type { ProjectionFunction } from "./transform-bounds.js";
import { makeClampedForwardTo3857 } from "./web-mercator.js";

/**
 * The functions that project between a CRS and WGS84 or Web Mercator, and the
 * CRS's meters per unit.
 *
 * @param projection The CRS, as {@link parseWkt} or an EPSG resolver gives it.
 */
export function projectionFunctions(projection: ProjectionDefinition): {
  /** From the CRS to WGS84 longitude and latitude. */
  projectTo4326: ProjectionFunction;
  /** From WGS84 longitude and latitude to the CRS. */
  projectFrom4326: ProjectionFunction;
  /**
   * From the CRS to Web Mercator, with latitudes clamped to Web Mercator's
   * limit (see {@link makeClampedForwardTo3857}).
   */
  projectTo3857: ProjectionFunction;
  /** From Web Mercator to the CRS. */
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
    projectTo4326,
    projectFrom4326,
    projectTo3857,
    projectFrom3857,
    mpu,
  };
}
