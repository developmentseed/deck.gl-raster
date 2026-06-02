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

describe("RasterTileset2D.getTileMetadata — _antimeridianCut", () => {
  it("returns _antimeridianCut on a tile whose native lngs cross ±180 (antimeridian.tif shape)", () => {
    // antimeridian.tif: rasterio.from_origin(-204, 24, 1, 1), 42×42 EPSG:4326.
    // One tile covers the whole image, with native lngs (−204, −162) crossing
    // −180° at u = 24/42.
    const level = new AffineTilesetLevel({
      affine: compose(translation(-204, 24), scale(1, -1)),
      arrayWidth: 42,
      arrayHeight: 42,
      tileWidth: 42,
      tileHeight: 42,
      mpu: 1,
    });
    const descriptor = new AffineTileset({ levels: [level], ...PROJECTIONS });
    const tileset = new RasterTileset2D(tilesetProps(), descriptor);

    const metadata = tileset.getTileMetadata({ x: 0, y: 0, z: 0 });

    expect(metadata._antimeridianCut).toBeDefined();
    expect(metadata._antimeridianCut?.uCut).toBeCloseTo(24 / 42, 9);
  });

  it("does NOT set _antimeridianCut on a non-crossing tile", () => {
    // A tile entirely east of the antimeridian: native lngs (0, 170).
    const level = new AffineTilesetLevel({
      affine: compose(translation(0, 90), scale(1, -1)),
      arrayWidth: 170,
      arrayHeight: 180,
      tileWidth: 170,
      tileHeight: 180,
      mpu: 1,
    });
    const descriptor = new AffineTileset({ levels: [level], ...PROJECTIONS });
    const tileset = new RasterTileset2D(tilesetProps(), descriptor);

    const metadata = tileset.getTileMetadata({ x: 0, y: 0, z: 0 });

    expect(metadata._antimeridianCut).toBeUndefined();
  });
});
