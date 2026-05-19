import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import { compose, scale, translation } from "@developmentseed/affine";
import { describe, expect, it } from "vitest";
import { AffineTileset } from "../../src/raster-tileset/affine-tileset.js";
import { AffineTilesetLevel } from "../../src/raster-tileset/affine-tileset-level.js";
import { RasterTileset2D } from "../../src/raster-tileset/raster-tileset-2d.js";

const identity = (x: number, y: number): [number, number] => [x, y];

const PROJECTIONS = {
  projectTo3857: identity,
  projectFrom3857: identity,
  projectTo4326: identity,
  projectFrom4326: identity,
};

function tilesetProps(): Tileset2DProps {
  return { getTileData: () => new Promise(() => {}) } as Tileset2DProps;
}

describe("RasterTileset2D.getTileMetadata", () => {
  it("attaches per-tile forwardTransform/inverseTransform to RasterTileMetadata", () => {
    const level = new AffineTilesetLevel({
      affine: compose(translation(100, 200), scale(10, -10)),
      arrayWidth: 8,
      arrayHeight: 8,
      tileWidth: 4,
      tileHeight: 4,
      mpu: 1,
    });
    const descriptor = new AffineTileset({
      levels: [level],
      ...PROJECTIONS,
    });
    const tileset = new RasterTileset2D(tilesetProps(), descriptor);

    const metadata = tileset.getTileMetadata({ x: 1, y: 1, z: 0 });

    expect(typeof metadata.forwardTransform).toBe("function");
    expect(typeof metadata.inverseTransform).toBe("function");

    // Tile (1,1) at pixel (0,0) should map to the CRS origin of that tile.
    // Tile is 4x4 pixels at 10 CRS units/pixel from origin (100, 200), Y flipped.
    const [x, y] = metadata.forwardTransform(0, 0);
    expect(x).toBeCloseTo(140, 10);
    expect(y).toBeCloseTo(160, 10);

    // Round-trip via inverseTransform.
    const [px, py] = metadata.inverseTransform(x, y);
    expect(px).toBeCloseTo(0, 10);
    expect(py).toBeCloseTo(0, 10);
  });
});

describe("RasterTileset2D.getTileMetadata referencePointMeters", () => {
  it("computes the centroid of projectedCorners in projected (3857) coordinates", () => {
    const level = new AffineTilesetLevel({
      affine: compose(translation(100, 200), scale(10, -10)),
      arrayWidth: 8,
      arrayHeight: 8,
      tileWidth: 4,
      tileHeight: 4,
      mpu: 1,
    });
    const descriptor = new AffineTileset({
      levels: [level],
      ...PROJECTIONS,
    });
    const tileset = new RasterTileset2D(tilesetProps(), descriptor);

    const metadata = tileset.getTileMetadata({ x: 1, y: 1, z: 0 });
    const { topLeft, topRight, bottomLeft, bottomRight } =
      metadata.projectedCorners;
    const expectedX =
      (topLeft[0] + topRight[0] + bottomLeft[0] + bottomRight[0]) / 4;
    const expectedY =
      (topLeft[1] + topRight[1] + bottomLeft[1] + bottomRight[1]) / 4;

    expect(metadata.referencePointMeters[0]).toBeCloseTo(expectedX, 10);
    expect(metadata.referencePointMeters[1]).toBeCloseTo(expectedY, 10);
  });
});
