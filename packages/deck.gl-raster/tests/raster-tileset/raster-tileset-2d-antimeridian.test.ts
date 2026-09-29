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

// EPSG:3857's well-known half-circumference (meters at ±180°).
const HALF_CIRCUMFERENCE = 20037508.342789244;
const TILE_SIZE = 512;

/**
 * Wraps `lngDegrees` to `(−180°, 180°]` before converting to 3857 meters —
 * mimicking what a *projected* source CRS's forward-to-3857 composition
 * does in practice: it passes through a periodic geographic intermediate
 * that proj4 normalizes, so a native lng outside that range wraps (see
 * `buildPieceReprojection`'s doc comment). A source CRS that's *directly*
 * EPSG:4326 (the `antimeridianCut` detection tests below) does not — hence
 * two separate projection mocks in this file.
 */
function lngDegreesToWrappedMercatorX(lngDegrees: number): number {
  let wrapped = lngDegrees;
  while (wrapped > 180) {
    wrapped -= 360;
  }
  while (wrapped <= -180) {
    wrapped += 360;
  }
  return (wrapped / 180) * HALF_CIRCUMFERENCE;
}

const WRAPPING_PROJECTIONS = {
  projectTo3857: (x: number, y: number): [number, number] => [
    lngDegreesToWrappedMercatorX(x),
    y,
  ],
  projectFrom3857: (x: number, y: number): [number, number] => [
    (x / HALF_CIRCUMFERENCE) * 180,
    y,
  ],
  // Detection (`antimeridianCut`) needs native, un-normalized corner lngs —
  // see the `antimeridian.tif` comment below. Identity here matches an
  // EPSG:4326 source (proj4 4326→4326 does not renormalize).
  projectTo4326: identity,
  projectFrom4326: identity,
};

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

  describe("piece reprojection (buildPieceReprojection)", () => {
    // Same antimeridian.tif shape (native lngs −204..−162, uCut = 24/42),
    // but with WRAPPING_PROJECTIONS so `forwardReproject` actually exercises
    // proj4-style wraparound — the mechanism the fix corrects for.
    function crossingMetadata() {
      const level = new AffineTilesetLevel({
        affine: compose(translation(-204, 24), scale(1, -1)),
        arrayWidth: 42,
        arrayHeight: 42,
        tileWidth: 42,
        tileHeight: 42,
        mpu: 1,
      });
      const descriptor = new AffineTileset({
        levels: [level],
        ...WRAPPING_PROJECTIONS,
      });
      const tileset = new RasterTileset2D(tilesetProps(), descriptor);
      return tileset.getTileMetadata({ x: 0, y: 0, z: 0 });
    }

    it("leaves forwardTransform/inverseTransform untouched — the correction lives in forwardReproject, not the geotransform", () => {
      const metadata = crossingMetadata();
      expect(metadata._westReprojection!.forwardTransform(5, 5)).toEqual(
        metadata.forwardTransform(5, 5),
      );
      expect(metadata._eastReprojection!.inverseTransform(5, 5)).toEqual(
        metadata.inverseTransform(5, 5),
      );
    });

    it("leaves a point that wraps to common-space x ≥ TILE_SIZE/2 unshifted (west piece's own territory)", () => {
      const metadata = crossingMetadata();
      // Native lng −204° wraps to +156° → common-space x ≈ 477.9 (≥ 256).
      const [cx] = metadata._westReprojection!.forwardReproject(-204, 24);
      expect(cx).toBeGreaterThanOrEqual(TILE_SIZE / 2);
      expect(cx).toBeCloseTo(477.87, 1);
    });

    it("leaves the east piece's interior unshifted (already its own natural, near-0 position)", () => {
      const metadata = crossingMetadata();
      // Native lng −162° wraps to −162° (already in range) → common-space
      // x ≈ 25.6 (< 256) — left as-is, since this IS the east piece's own
      // natural position. Forcing it to join the west piece's frame (the old
      // +TILE_SIZE behavior) put it a full world away from wherever the
      // camera was actually looking whenever only the east piece was in
      // view — see `buildPieceReprojection`'s doc comment.
      const [cx] = metadata._eastReprojection!.forwardReproject(-162, 24);
      expect(cx).toBeCloseTo(25.6, 1);
    });

    it("shifts the seam corner by -TILE_SIZE for the east piece, joining its own interior instead of the west piece's frame", () => {
      // The seam itself: native lng −180° wraps to exactly +180° →
      // common-space x = TILE_SIZE exactly (512). For the WEST piece this is
      // its own natural east edge — no shift. For the EAST piece this same
      // raw value is its own west edge, but belongs to the east piece's
      // natural (near-0) frame, so it shifts by -TILE_SIZE to join up with
      // that piece's interior (≈25.6) rather than sitting a full world away.
      const metadata = crossingMetadata();
      const [westCx] = metadata._westReprojection!.forwardReproject(-180, 24);
      const [eastCx] = metadata._eastReprojection!.forwardReproject(-180, 24);
      expect(westCx).toBeCloseTo(TILE_SIZE, 9);
      expect(eastCx).toBeCloseTo(0, 9);
    });

    it("round-trips forwardReproject/inverseReproject for a shifted point", () => {
      const metadata = crossingMetadata();
      const { forwardReproject, inverseReproject } =
        metadata._eastReprojection!;
      const [cx, cy] = forwardReproject(-162, 24);
      const [x, y] = inverseReproject(cx, cy);
      expect(x).toBeCloseTo(-162, 6);
      expect(y).toBeCloseTo(24, 6);
    });
  });
});
