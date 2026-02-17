/**
 * Coefficient to convert the coordinate reference system (CRS)
 * units into meters (metersPerUnit).
 *
 * From note g in http://docs.opengeospatial.org/is/17-083r2/17-083r2.html#table_2:
 *
 * > If the CRS uses meters as units of measure for the horizontal dimensions,
 * > then metersPerUnit=1; if it has degrees, then metersPerUnit=2pa/360
 * > (a is the Earth maximum radius of the ellipsoid).
 *
 * @param unit - The unit of the CRS.
 * @param semiMajorAxis - The semi-major axis of the ellipsoid, required if unit is 'degree'.
 * @returns The meters per unit conversion factor.
 */

import type { TileMatrix, TileMatrixSet } from "./types";

// https://github.com/developmentseed/morecantile/blob/7c95a11c491303700d6e33e9c1607f2719584dec/morecantile/utils.py#L67-L90
export function metersPerUnit(
  unit:
    | "m"
    | "metre"
    | "meter"
    | "meters"
    | "foot"
    | "us survey foot"
    | "degree",
  { semiMajorAxis }: { semiMajorAxis?: number } = {},
): number {
  unit = unit.toLowerCase() as typeof unit;
  switch (unit) {
    case "m":
    case "metre":
    case "meter":
    case "meters":
      return 1;
    case "foot":
      return 0.3048;
    case "us survey foot":
      return 1200 / 3937;
  }

  if (unit === "degree") {
    // 2 * π * ellipsoid semi-major-axis / 360
    if (semiMajorAxis === undefined) {
      throw new Error(
        "CRS with degrees unit requires ellipsoid semi-major-axis",
      );
    }

    return (2 * Math.PI * semiMajorAxis) / 360;
  }

  throw new Error(
    `Unsupported CRS units: ${unit} when computing metersPerUnit.`,
  );
}

export function narrowTileMatrixSet(
  obj: TileMatrix | TileMatrixSet,
): obj is TileMatrixSet {
  return "tileMatrices" in obj;
}
