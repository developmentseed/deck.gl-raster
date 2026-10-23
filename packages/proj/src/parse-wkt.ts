import wktParser from "wkt-parser";
import type { ProjJson } from "./projjson.js";

export interface DatumDefinition {
  /** The type of datum. */
  datum_type: number;
  /** Semi-major axis of the ellipsoid. */
  a: number;
  /** Semi-minor axis of the ellipsoid. */
  b: number;
  /** Eccentricity squared of the ellipsoid. */
  es: number;
  /** Second eccentricity squared of the ellipsoid. */
  ep2: number;
}

export interface ProjectionDefinition {
  title: string;
  projName?: string;
  ellps?: string;
  datum?: DatumDefinition;
  datumName?: string;
  rf?: number;
  lat0?: number;
  lat1?: number;
  lat2?: number;
  lat_ts?: number;
  long0?: number;
  long1?: number;
  long2?: number;
  alpha?: number;
  longc?: number;
  x0?: number;
  y0?: number;
  k0?: number;
  a?: number;
  b?: number;
  R_A?: true;
  zone?: number;
  utmSouth?: true;
  datum_params?: string | number[];
  to_meter?: number;
  units?: string;
  from_greenwich?: number;
  datumCode?: string;
  nadgrids?: string;
  axis?: string;
  sphere?: boolean;
  rectified_grid_angle?: number;
  approx?: boolean;
  over?: boolean;
  projStr?: string;
}

/**
 * Parse a WKT string or PROJJSON object into a proj4-compatible projection
 * definition.
 *
 * This is a typed wrapper around the `wkt-parser` package.
 */
export function parseWkt(input: string | ProjJson): ProjectionDefinition {
  const def = wktParser(input);

  // wkt-parser doesn't always resolve per-axis units from GeographicCRS
  // PROJJSON, leaving units: "unknown". longlat is always degrees by definition.
  if (def.projName === "longlat" && (!def.units || def.units === "unknown")) {
    def.units = "degree";
    def.to_meter = undefined;
  }

  // wkt-parser keeps the method name of Cylindrical Equal Area ("Lambert
  // Cylindrical Equal Area" in WKT2 and PROJJSON, "Cylindrical_Equal_Area" in
  // WKT1) and puts its standard parallel in lat1. proj4 knows the projection
  // only as "cea", which reads the standard parallel from lat_ts.
  const method = def.projName?.toLowerCase().replace(/_/g, " ");
  if (
    method === "lambert cylindrical equal area" ||
    method === "cylindrical equal area"
  ) {
    def.projName = "cea";
    def.lat_ts = def.lat1 ?? 0;
  }

  return def;
}
