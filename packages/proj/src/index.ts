export type { DatumDefinition, ProjectionDefinition } from "wkt-parser";
export { default as wktParser } from "wkt-parser";
export { metersPerUnit } from "./meters-per-unit.js";
export type {
  GeographicCRS,
  ProjectedCRS,
  ProjJson,
  ProjJsonConversion,
  ProjJsonCoordinateSystem,
  ProjJsonDatum,
  ProjJsonEllipsoid,
  ProjJsonParameter,
  ProjJsonUnit,
} from "./projjson.js";
export type { EpsgResolver } from "./registry.js";
export { epsgResolver, PROJECTION_REGISTRY } from "./registry.js";
export type { Bounds, Point, ProjectionFunction } from "./transform-bounds.js";
export { transformBounds } from "./transform-bounds.js";
export { makeClampedForwardTo3857 } from "./web-mercator.js";
