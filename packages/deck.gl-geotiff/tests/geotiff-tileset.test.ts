import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import { describe, expect, it } from "vitest";
import { geoTiffToDescriptor } from "../src/geotiff-tileset.js";

const identityProjection = (x: number, y: number): [number, number] => [x, y];
const PROJECTIONS = {
  projectTo3857: identityProjection,
  projectFrom3857: identityProjection,
  projectTo4326: identityProjection,
  projectFrom4326: identityProjection,
};

function makeOverview(
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number,
  affine: readonly [number, number, number, number, number, number],
): Overview {
  return {
    width,
    height,
    tileWidth,
    tileHeight,
    transform: affine,
  } as unknown as Overview;
}

describe("geoTiffToDescriptor", () => {
  it("creates one level per overview plus the full-resolution image, coarsest first", () => {
    // GeoTIFF.overviews is sorted finest-to-coarsest. Reversed and with the
    // full-res image appended, the levels emitted should be:
    // coarser overview (200), finer overview (400), full-res (800).
    const fullRes = makeOverview(800, 800, 256, 256, [10, 0, 0, 0, -10, 8000]);
    const finerOverview = makeOverview(
      400,
      400,
      256,
      256,
      [20, 0, 0, 0, -20, 8000],
    );
    const coarserOverview = makeOverview(
      200,
      200,
      256,
      256,
      [40, 0, 0, 0, -40, 8000],
    );
    const geotiff = {
      width: fullRes.width,
      height: fullRes.height,
      tileWidth: fullRes.tileWidth,
      tileHeight: fullRes.tileHeight,
      transform: fullRes.transform,
      overviews: [finerOverview, coarserOverview],
    } as unknown as GeoTIFF;

    const descriptor = geoTiffToDescriptor(geotiff, {
      ...PROJECTIONS,
      mpu: 1,
    });

    expect(descriptor.levels).toHaveLength(3);
    // Coarsest first: matrixWidth = ceil(200/256) = 1
    expect(descriptor.levels[0]!.matrixWidth).toBe(1);
    // Full-res last: matrixWidth = ceil(800/256) = 4
    expect(descriptor.levels[2]!.matrixWidth).toBe(4);
  });

  it("propagates projection functions and computes projectedBounds from coarsest level", () => {
    const fullRes = makeOverview(8, 8, 4, 4, [10, 0, 100, 0, -10, 200]);
    const coarseOverview = makeOverview(4, 4, 4, 4, [20, 0, 100, 0, -20, 200]);
    const geotiff = {
      width: fullRes.width,
      height: fullRes.height,
      tileWidth: fullRes.tileWidth,
      tileHeight: fullRes.tileHeight,
      transform: fullRes.transform,
      overviews: [coarseOverview],
    } as unknown as GeoTIFF;

    const descriptor = geoTiffToDescriptor(geotiff, {
      ...PROJECTIONS,
      mpu: 1,
    });

    expect(descriptor.projectTo3857).toBe(PROJECTIONS.projectTo3857);
    // Coarsest 4×4 array, affine [20,0,100,0,-20,200]
    // → corners (100,200), (180,200), (100,120), (180,120)
    expect(descriptor.projectedBounds).toEqual([100, 120, 180, 200]);
  });
});
