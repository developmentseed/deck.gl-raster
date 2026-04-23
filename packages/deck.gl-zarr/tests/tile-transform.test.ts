import type { GeoZarrMetadata } from "@developmentseed/geozarr";
import { describe, expect, it } from "vitest";
import { geoZarrToDescriptor } from "../src/zarr-tileset.js";

const identityProjection = (x: number, y: number): [number, number] => [x, y];

// Minimal GeoZarrMetadata: one level, simple scale+translate affine.
// x' = 10*col + 100, y' = -10*row + 200 (top-left origin convention)
const META: GeoZarrMetadata = {
  crs: { code: "EPSG:4326" },
  axes: ["y", "x"],
  levels: [
    {
      path: "0",
      arrayWidth: 8,
      arrayHeight: 8,
      affine: [10, 0, 100, 0, -10, 200],
    },
  ],
} as unknown as GeoZarrMetadata;

describe("ZarrTilesetLevel.tileTransform", () => {
  const descriptor = geoZarrToDescriptor(META, {
    projectTo4326: identityProjection,
    projectFrom4326: identityProjection,
    projectTo3857: identityProjection,
    projectFrom3857: identityProjection,
    chunkSizes: [{ width: 4, height: 4 }],
    mpu: 1,
  });
  const level = descriptor.levels[0]!;

  it("maps the origin pixel of tile (1,1) through the composed affine", () => {
    // tile (1,1) has pixel offset (4,4) in the full array
    const { forwardTransform } = level.tileTransform(1, 1);
    const [x, y] = forwardTransform(0, 0);
    // expected = affine.apply(META.affine, 4, 4) = (10*4+100, -10*4+200) = (140, 160)
    expect(x).toBeCloseTo(140, 10);
    expect(y).toBeCloseTo(160, 10);
  });

  it("round-trips through forward+inverse", () => {
    const { forwardTransform, inverseTransform } = level.tileTransform(1, 1);
    const [cx, cy] = forwardTransform(2.5, 1.5);
    const [px, py] = inverseTransform(cx, cy);
    expect(px).toBeCloseTo(2.5, 10);
    expect(py).toBeCloseTo(1.5, 10);
  });
});
