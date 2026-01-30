/**
 * Internal type definitions for deck.gl-zarr
 */

import type {
  Bounds,
  FormatDescriptor,
  ZarrLevelMetadata,
  ZarrMultiscaleMetadata,
} from "zarr-multiscale-metadata";
import type { TileMatrixSet } from "@developmentseed/deck.gl-raster";
import type { Readable } from "zarrita";
import type { ProjectionDefinition } from "proj4";
import type { PROJJSONDefinition } from "proj4/dist/lib/core";

export type { Bounds };

/**
 * Supported CRS unit types for scale denominator calculation
 */
export type SupportedCrsUnit =
  | "m"
  | "metre"
  | "meter"
  | "meters"
  | "foot"
  | "US survey foot"
  | "degree";

/**
 * Projection information extracted from Zarr metadata or user-provided
 */
export interface ProjectionInfo {
  /** Proj4-compatible projection definition (PROJJSON or proj4 string) */
  def: string | PROJJSONDefinition;
  /** A parsed projection definition */
  parsed: ProjectionDefinition;
  /** Units of the coordinate system */
  coordinatesUnits: SupportedCrsUnit;
  /** CRS code if known (e.g., "EPSG:4326", "EPSG:3857") */
  code?: string;
}

/**
 * Sorted level with mapping back to original Zarr path
 */
export interface SortedLevel {
  /** TMS index (0 = coarsest) */
  tmsIndex: number;
  /** Original Zarr level path */
  zarrPath: string;
  /** Resolution in CRS units per pixel */
  resolution: [number, number];
  /** Original level metadata */
  level: ZarrLevelMetadata;
}

/**
 * Result of parsing Zarr metadata for tile matrix set construction
 */
export interface ZarrTileMatrixSetResult {
  /** The tile matrix set */
  tileMatrixSet: TileMatrixSet;
  /** Sorted levels mapping TMS index to Zarr path */
  sortedLevels: SortedLevel[];
}

/**
 * Options for parseZarrTileMatrixSet
 */
export interface ParseZarrTileMatrixSetOptions {
  /** Override CRS code (e.g., 'EPSG:4326') */
  crs?: string;
}

/**
 * State managed by ZarrLayer
 */
export interface ZarrLayerState {
  zarrMetadata?: ZarrMultiscaleMetadata;
  formatDescriptor?: FormatDescriptor;
  bounds?: Bounds;
  tileMatrixSet?: TileMatrixSet;
  sortedLevels?: SortedLevel[];
  root?: zarr.Location<Readable>;
  forwardReproject?: (x: number, y: number) => [number, number];
  inverseReproject?: (x: number, y: number) => [number, number];
  projectionInfo?: ProjectionInfo;
}

/**
 * Colormap function that maps a normalized value (0-255) to an RGBA color.
 */
export type ColormapFunction = (normalizedValue: number) => [number, number, number, number];

// Zarrita namespace for type imports
import type * as zarr from "zarrita";
