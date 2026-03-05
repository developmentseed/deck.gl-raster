import * as affine from "@developmentseed/affine";
import type { GeoTIFF } from "@developmentseed/geotiff";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import proj4 from "proj4";
import type { PROJJSONDefinition } from "proj4/dist/lib/core";
import type Projection from "proj4/dist/lib/Proj";
import type { ProjectionDefinition } from "wkt-parser";

// Derived from existing work here:
// https://github.com/developmentseed/lonboard/blob/35a1f3d691604ad9e083bf10a4bfde4158171486/src/cog-tileset/claude-tileset-2d-improved.ts#L141
//
// TODO: return a RasterReprojector instance, given the IFD and tile of interest?
export async function extractGeotiffReprojectors(
  geotiff: GeoTIFF,
  sourceProjection: string | PROJJSONDefinition | ProjectionDefinition,
  outputCrs: string | PROJJSONDefinition | Projection = "EPSG:4326",
): Promise<ReprojectionFns> {
  // @ts-expect-error - proj4 type definitions are incomplete and don't include
  // support for wkt-parser output
  const converter = proj4(sourceProjection, outputCrs);
  const { forwardTransform, inverseTransform } = fromAffine(geotiff.transform);

  return {
    forwardTransform,
    inverseTransform,
    forwardReproject: (x: number, y: number) =>
      converter.forward([x, y], false),
    inverseReproject: (x: number, y: number) =>
      converter.inverse([x, y], false),
  };
}

export function fromAffine(
  geotransform: [number, number, number, number, number, number],
): {
  forwardTransform: (x: number, y: number) => [number, number];
  inverseTransform: (x: number, y: number) => [number, number];
} {
  const inverseGeotransform = affine.invert(geotransform);
  return {
    forwardTransform: (x: number, y: number) =>
      affine.apply(geotransform, x, y),
    inverseTransform: (x: number, y: number) =>
      affine.apply(inverseGeotransform, x, y),
  };
}
