import { compose, scale, translation } from "@developmentseed/affine";
import { describe, expect, it } from "vitest";
import { AffineTileset } from "../../src/raster-tileset/affine-tileset.js";
import { AffineTilesetLevel } from "../../src/raster-tileset/affine-tileset-level.js";

const identityProjection = (x: number, y: number): [number, number] => [x, y];

const PROJECTIONS = {
  projectTo3857: identityProjection,
  projectFrom3857: identityProjection,
  projectTo4326: identityProjection,
  projectFrom4326: identityProjection,
};

describe("AffineTileset", () => {
  it("derives projectedBounds from the coarsest level (axis-aligned)", () => {
    // Coarsest: 4×4 array, 20-units-per-pixel, top-left origin at (100, 200).
    const coarsest = new AffineTilesetLevel({
      affine: compose(translation(100, 200), scale(20, -20)),
      arrayWidth: 4,
      arrayHeight: 4,
      tileWidth: 4,
      tileHeight: 4,
      mpu: 1,
    });
    const finest = new AffineTilesetLevel({
      affine: compose(translation(100, 200), scale(10, -10)),
      arrayWidth: 8,
      arrayHeight: 8,
      tileWidth: 4,
      tileHeight: 4,
      mpu: 1,
    });
    const tileset = new AffineTileset({
      levels: [coarsest, finest],
      ...PROJECTIONS,
    });
    expect(tileset.projectedBounds).toEqual([100, 120, 180, 200]);
  });

  it("derives projectedBounds correctly for a rotated coarsest level", () => {
    // Affine [0, -1, 100, 1, 0, 200] rotates pixel (x,y) → CRS (-y+100, x+200).
    // 4×4 array corners: (100,200), (100,204), (96,200), (96,204).
    const coarsest = new AffineTilesetLevel({
      affine: [0, -1, 100, 1, 0, 200],
      arrayWidth: 4,
      arrayHeight: 4,
      tileWidth: 4,
      tileHeight: 4,
      mpu: 1,
    });
    const tileset = new AffineTileset({
      levels: [coarsest],
      ...PROJECTIONS,
    });
    expect(tileset.projectedBounds).toEqual([96, 200, 100, 204]);
  });

  it("exposes levels and projection functions verbatim", () => {
    const level = new AffineTilesetLevel({
      affine: compose(translation(0, 0), scale(10, -10)),
      arrayWidth: 4,
      arrayHeight: 4,
      tileWidth: 4,
      tileHeight: 4,
      mpu: 1,
    });
    const tileset = new AffineTileset({
      levels: [level],
      ...PROJECTIONS,
    });
    expect(tileset.levels).toEqual([level]);
    expect(tileset.projectTo3857).toBe(PROJECTIONS.projectTo3857);
    expect(tileset.projectFrom3857).toBe(PROJECTIONS.projectFrom3857);
    expect(tileset.projectTo4326).toBe(PROJECTIONS.projectTo4326);
    expect(tileset.projectFrom4326).toBe(PROJECTIONS.projectFrom4326);
  });

  it("throws when constructed with no levels", () => {
    expect(
      () =>
        new AffineTileset({
          levels: [],
          ...PROJECTIONS,
        }),
    ).toThrow();
  });
});
