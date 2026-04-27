import { describe, expect, it } from "vitest";
import { AffineTilesetLevel } from "../../src/raster-tileset/affine-tileset-level.js";

// Top-left origin, 10 CRS units per pixel, square pixels.
// x = 10*col + 100, y = -10*row + 200
const SQUARE_AFFINE = [10, 0, 100, 0, -10, 200] as const;

// Non-square pixels: 10 CRS units wide, 5 CRS units tall.
// x = 10*col + 100, y = -5*row + 200
const NON_SQUARE_AFFINE = [10, 0, 100, 0, -5, 200] as const;

// 30° rotation around origin, 10 unit scale.
const ROT30 = (Math.PI * 30) / 180;
const ROTATED_AFFINE = [
  10 * Math.cos(ROT30),
  -10 * Math.sin(ROT30),
  100,
  10 * Math.sin(ROT30),
  10 * Math.cos(ROT30),
  200,
] as const;

describe("AffineTilesetLevel", () => {
  describe("matrix dimensions", () => {
    it("computes matrixWidth and matrixHeight via ceil(arraySize / tileSize)", () => {
      const level = new AffineTilesetLevel({
        affine: SQUARE_AFFINE,
        arrayWidth: 10,
        arrayHeight: 12,
        tileWidth: 4,
        tileHeight: 4,
        mpu: 1,
      });
      expect(level.matrixWidth).toBe(3);
      expect(level.matrixHeight).toBe(3);
    });
  });

  describe("metersPerPixel", () => {
    it("returns mpu * pixel size for square pixels", () => {
      const level = new AffineTilesetLevel({
        affine: SQUARE_AFFINE,
        arrayWidth: 8,
        arrayHeight: 8,
        tileWidth: 4,
        tileHeight: 4,
        mpu: 1,
      });
      expect(level.metersPerPixel).toBeCloseTo(10, 10);
    });

    it("returns geometric mean of pixel edges for non-square pixels", () => {
      const level = new AffineTilesetLevel({
        affine: NON_SQUARE_AFFINE,
        arrayWidth: 8,
        arrayHeight: 8,
        tileWidth: 4,
        tileHeight: 4,
        mpu: 1,
      });
      expect(level.metersPerPixel).toBeCloseTo(Math.sqrt(50), 10);
    });

    it("multiplies by mpu for non-meter CRS units", () => {
      const level = new AffineTilesetLevel({
        affine: SQUARE_AFFINE,
        arrayWidth: 8,
        arrayHeight: 8,
        tileWidth: 4,
        tileHeight: 4,
        mpu: 111000,
      });
      expect(level.metersPerPixel).toBeCloseTo(10 * 111000, 5);
    });
  });

  describe("projectedTileCorners", () => {
    it("returns the four CRS corners of an axis-aligned tile", () => {
      const level = new AffineTilesetLevel({
        affine: SQUARE_AFFINE,
        arrayWidth: 8,
        arrayHeight: 8,
        tileWidth: 4,
        tileHeight: 4,
        mpu: 1,
      });
      const corners = level.projectedTileCorners(0, 0);
      expect(corners.topLeft).toEqual([100, 200]);
      expect(corners.topRight).toEqual([140, 200]);
      expect(corners.bottomLeft).toEqual([100, 160]);
      expect(corners.bottomRight).toEqual([140, 160]);
    });

    it("returns rotated quadrilateral corners for a rotated affine", () => {
      const level = new AffineTilesetLevel({
        affine: ROTATED_AFFINE,
        arrayWidth: 8,
        arrayHeight: 8,
        tileWidth: 4,
        tileHeight: 4,
        mpu: 1,
      });
      const corners = level.projectedTileCorners(0, 0);
      expect(corners.topLeft[0]).toBeCloseTo(100, 10);
      expect(corners.topLeft[1]).toBeCloseTo(200, 10);
      expect(corners.topRight[0]).toBeCloseTo(
        100 + 4 * 10 * Math.cos(ROT30),
        10,
      );
      expect(corners.topRight[1]).toBeCloseTo(
        200 + 4 * 10 * Math.sin(ROT30),
        10,
      );
    });
  });

  describe("tileTransform", () => {
    it("maps tile-local pixel (0,0) of tile (1,1) to the correct CRS coord", () => {
      const level = new AffineTilesetLevel({
        affine: SQUARE_AFFINE,
        arrayWidth: 8,
        arrayHeight: 8,
        tileWidth: 4,
        tileHeight: 4,
        mpu: 1,
      });
      const { forwardTransform } = level.tileTransform(1, 1);
      const [x, y] = forwardTransform(0, 0);
      expect(x).toBeCloseTo(140, 10);
      expect(y).toBeCloseTo(160, 10);
    });

    it("round-trips through forward+inverse", () => {
      const level = new AffineTilesetLevel({
        affine: ROTATED_AFFINE,
        arrayWidth: 8,
        arrayHeight: 8,
        tileWidth: 4,
        tileHeight: 4,
        mpu: 1,
      });
      const { forwardTransform, inverseTransform } = level.tileTransform(1, 0);
      const [cx, cy] = forwardTransform(2.5, 1.5);
      const [px, py] = inverseTransform(cx, cy);
      expect(px).toBeCloseTo(2.5, 10);
      expect(py).toBeCloseTo(1.5, 10);
    });
  });

  describe("crsBoundsToTileRange", () => {
    it("maps a CRS bbox covering tile (1,1) only to that single tile", () => {
      const level = new AffineTilesetLevel({
        affine: SQUARE_AFFINE,
        arrayWidth: 8,
        arrayHeight: 8,
        tileWidth: 4,
        tileHeight: 4,
        mpu: 1,
      });
      const range = level.crsBoundsToTileRange(141, 121, 179, 159);
      expect(range).toEqual({ minCol: 1, maxCol: 1, minRow: 1, maxRow: 1 });
    });

    it("clamps negative or out-of-range indices to matrix bounds", () => {
      const level = new AffineTilesetLevel({
        affine: SQUARE_AFFINE,
        arrayWidth: 8,
        arrayHeight: 8,
        tileWidth: 4,
        tileHeight: 4,
        mpu: 1,
      });
      const range = level.crsBoundsToTileRange(-10000, -10000, 10000, 10000);
      expect(range).toEqual({ minCol: 0, maxCol: 1, minRow: 0, maxRow: 1 });
    });

    it("returns an empty range (min > max) when the bbox lies entirely outside the array", () => {
      const level = new AffineTilesetLevel({
        affine: SQUARE_AFFINE,
        arrayWidth: 8,
        arrayHeight: 8,
        tileWidth: 4,
        tileHeight: 4,
        mpu: 1,
      });
      // Array CRS extent: x ∈ [100, 180), y ∈ [200, 120). Pick a bbox far to
      // the right of the array.
      const range = level.crsBoundsToTileRange(1000, 1000, 2000, 2000);
      // minCol > maxCol means the consumer's `for (col=min; col<=max)` loop
      // emits no tiles — which is what we want for a non-overlapping bbox.
      expect(range.minCol).toBeGreaterThan(range.maxCol);
    });

    it("handles non-square pixels correctly", () => {
      const level = new AffineTilesetLevel({
        affine: NON_SQUARE_AFFINE,
        arrayWidth: 8,
        arrayHeight: 8,
        tileWidth: 4,
        tileHeight: 4,
        mpu: 1,
      });
      const range = level.crsBoundsToTileRange(101, 181, 139, 199);
      expect(range).toEqual({ minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 });
    });
  });
});
