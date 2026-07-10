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
    expect(metadata._westReprojection).toBeUndefined();
    expect(metadata._eastReprojection).toBeUndefined();
  });

  it("shifts the west piece's geotransform by +360° so its native lngs round-trip through proj4", () => {
    // antimeridian.tif shape again. West piece native lngs (−204°, −180°) are
    // outside proj4's valid range. The piece's forwardTransform must add 360°
    // to land in [+156°, +180°]; the matching inverseTransform must subtract
    // 360° so pixel coords round-trip cleanly.
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

    expect(metadata._westReprojection).toBeDefined();
    const { forwardTransform: westFwd, inverseTransform: westInv } =
      metadata._westReprojection!;

    // Pixel (0, 0) → native (−204, 24) → shifted (+156, 24)
    const [wx0, wy0] = westFwd(0, 0);
    expect(wx0).toBeCloseTo(156, 9);
    expect(wy0).toBeCloseTo(24, 9);

    // Inverse round-trip: shifted (+156, 24) → pixel (0, 0)
    const [wpx0, wpy0] = westInv(156, 24);
    expect(wpx0).toBeCloseTo(0, 9);
    expect(wpy0).toBeCloseTo(0, 9);
  });

  it("leaves the east piece's geotransform unshifted (its lngs already in range)", () => {
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

    expect(metadata._eastReprojection).toBeDefined();
    const { forwardTransform: eastFwd } = metadata._eastReprojection!;
    // East piece native lng midpoint = −171° ∈ [−180°, 180°] → no shift.
    // Seam pixel (col 24, row 0) → native (−180, 24), unchanged.
    const [ex0, ey0] = eastFwd(24, 0);
    expect(ex0).toBeCloseTo(-180, 9);
    expect(ey0).toBeCloseTo(24, 9);
  });

  it("shifts the east piece by −360° for a fixture crossing native +180° (e.g. native [170, 190])", () => {
    // Mirror of the antimeridian.tif case: tile native lngs (170, 190). East
    // piece (180, 190) is outside proj4's range and must shift by −360°.
    const level = new AffineTilesetLevel({
      affine: compose(translation(170, 10), scale(1, -1)),
      arrayWidth: 20,
      arrayHeight: 20,
      tileWidth: 20,
      tileHeight: 20,
      mpu: 1,
    });
    const descriptor = new AffineTileset({ levels: [level], ...PROJECTIONS });
    const tileset = new RasterTileset2D(tilesetProps(), descriptor);

    const metadata = tileset.getTileMetadata({ x: 0, y: 0, z: 0 });

    expect(metadata._antimeridianCut?.uCut).toBeCloseTo(0.5, 9);
    expect(metadata._eastReprojection).toBeDefined();
    const { forwardTransform: eastFwd, inverseTransform: eastInv } =
      metadata._eastReprojection!;
    // East piece native (180, 190) − 360° = (−180, −170). Right pixel col 20 →
    // native 190 → shifted −170.
    const [ex, ey] = eastFwd(20, 0);
    expect(ex).toBeCloseTo(-170, 9);
    expect(ey).toBeCloseTo(10, 9);
    // Round-trip.
    const [epx, epy] = eastInv(-170, 10);
    expect(epx).toBeCloseTo(20, 9);
    expect(epy).toBeCloseTo(0, 9);
  });
});
