import type { Tiff, TiffImage } from "@cogeotiff/core";
import { Photometric, SubFileType, TiffTag } from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import type { Affine } from "../src/index.js";
import {
  applyGeoTransform,
  createWindow,
  extractGeotransform,
  GeoTIFF,
  index,
  intersectWindows,
  invertGeoTransform,
  isMaskIfd,
  Overview,
  xy,
} from "../src/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a mock TiffImage with configurable properties. */
function mockImage(opts: {
  width: number;
  height: number;
  tileWidth?: number;
  tileHeight?: number;
  tiled?: boolean;
  origin?: [number, number, number];
  resolution?: [number, number, number];
  subFileType?: number;
  photometric?: number;
  samplesPerPixel?: number;
  noData?: number | null;
  epsg?: number | null;
  bbox?: [number, number, number, number];
  modelTransformation?: number[] | null;
}): TiffImage {
  const tiled = opts.tiled ?? true;
  const tags = new Map<number, unknown>();

  if (opts.subFileType != null) {
    tags.set(TiffTag.SubFileType, opts.subFileType);
  }
  if (opts.photometric != null) {
    tags.set(TiffTag.Photometric, opts.photometric);
  }
  if (opts.samplesPerPixel != null) {
    tags.set(TiffTag.SamplesPerPixel, opts.samplesPerPixel);
  }
  if (opts.modelTransformation != null) {
    tags.set(TiffTag.ModelTransformation, opts.modelTransformation);
  }

  return {
    size: { width: opts.width, height: opts.height },
    tileSize: {
      width: opts.tileWidth ?? 256,
      height: opts.tileHeight ?? 256,
    },
    isTiled: () => tiled,
    origin: opts.origin ?? [0, 0, 0],
    resolution: opts.resolution ?? [1, -1, 0],
    noData: opts.noData ?? null,
    epsg: opts.epsg ?? null,
    bbox: opts.bbox ?? [0, 0, 100, 100],
    value: (tag: number) => {
      if (tags.has(tag)) return tags.get(tag);
      return null;
    },
    getTile: async (_x: number, _y: number) => ({
      bytes: new ArrayBuffer(8),
      mimeType: "image/jpeg",
      compression: 7, // JPEG
    }),
  } as unknown as TiffImage;
}

/** Create a mock Tiff with the given images. */
function mockTiff(images: TiffImage[]): Tiff {
  return { images } as unknown as Tiff;
}

// ── Window ───────────────────────────────────────────────────────────────────

describe("createWindow", () => {
  it("creates a valid window", () => {
    const w = createWindow(10, 20, 100, 200);
    expect(w).toEqual({ colOff: 10, rowOff: 20, width: 100, height: 200 });
  });

  it("rejects negative column offset", () => {
    expect(() => createWindow(-1, 0, 10, 10)).toThrow(/non-negative/);
  });

  it("rejects negative row offset", () => {
    expect(() => createWindow(0, -1, 10, 10)).toThrow(/non-negative/);
  });

  it("rejects zero width", () => {
    expect(() => createWindow(0, 0, 0, 10)).toThrow(/positive/);
  });

  it("rejects zero height", () => {
    expect(() => createWindow(0, 0, 10, 0)).toThrow(/positive/);
  });

  it("rejects negative dimensions", () => {
    expect(() => createWindow(0, 0, -5, 10)).toThrow(/positive/);
  });
});

describe("intersectWindows", () => {
  it("returns the overlapping region", () => {
    const a = createWindow(0, 0, 10, 10);
    const b = createWindow(5, 5, 10, 10);
    expect(intersectWindows(a, b)).toEqual({
      colOff: 5,
      rowOff: 5,
      width: 5,
      height: 5,
    });
  });

  it("returns null for non-overlapping windows", () => {
    const a = createWindow(0, 0, 5, 5);
    const b = createWindow(10, 10, 5, 5);
    expect(intersectWindows(a, b)).toBeNull();
  });

  it("returns null for edge-touching windows", () => {
    const a = createWindow(0, 0, 10, 10);
    const b = createWindow(10, 0, 10, 10);
    expect(intersectWindows(a, b)).toBeNull();
  });

  it("returns the contained window when one contains the other", () => {
    const outer = createWindow(0, 0, 100, 100);
    const inner = createWindow(10, 10, 20, 20);
    expect(intersectWindows(outer, inner)).toEqual(inner);
  });

  it("is commutative", () => {
    const a = createWindow(0, 0, 10, 10);
    const b = createWindow(5, 3, 10, 10);
    expect(intersectWindows(a, b)).toEqual(intersectWindows(b, a));
  });
});

// ── Transform ────────────────────────────────────────────────────────────────

describe("applyGeoTransform", () => {
  it("applies an identity-like transform", () => {
    const gt: Affine = [1, 0, 0, 0, 1, 0];
    expect(applyGeoTransform(3, 4, gt)).toEqual([3, 4]);
  });

  it("applies translation", () => {
    const gt: Affine = [1, 0, 10, 0, 1, 20];
    expect(applyGeoTransform(5, 5, gt)).toEqual([15, 25]);
  });

  it("applies scale + translation", () => {
    const gt: Affine = [0.5, 0, 100, 0, -0.5, 200];
    expect(applyGeoTransform(10, 20, gt)).toEqual([105, 190]);
  });
});

describe("invertGeoTransform", () => {
  it("inverts a simple scale+translate transform", () => {
    const gt: Affine = [2, 0, 10, 0, -3, 50];
    const inv = invertGeoTransform(gt);
    // Applying the inverse should undo the forward transform
    const [x, y] = applyGeoTransform(5, 7, gt);
    const [col, row] = applyGeoTransform(x, y, inv);
    expect(col).toBeCloseTo(5);
    expect(row).toBeCloseTo(7);
  });

  it("throws for a degenerate transform", () => {
    const gt: Affine = [0, 0, 0, 0, 0, 0];
    expect(() => invertGeoTransform(gt)).toThrow(/degenerate/);
  });
});

describe("index", () => {
  // Simple north-up, 1m resolution at (100, 200)
  const gt: Affine = [1, 0, 100, 0, -1, 200];

  it("returns [row, col] for a coordinate", () => {
    const [row, col] = index(gt, 105, 195);
    expect(col).toBe(5);
    expect(row).toBe(5);
  });

  it("uses Math.floor by default", () => {
    const [row, col] = index(gt, 100.9, 199.1);
    expect(col).toBe(0);
    expect(row).toBe(0);
  });

  it("accepts a custom rounding op", () => {
    const [row, col] = index(gt, 100.9, 199.1, Math.round);
    expect(col).toBe(1);
    expect(row).toBe(1);
  });
});

describe("xy", () => {
  const gt: Affine = [1, 0, 100, 0, -1, 200];

  it("returns pixel center by default", () => {
    const [x, y] = xy(gt, 0, 0);
    expect(x).toBeCloseTo(100.5);
    expect(y).toBeCloseTo(199.5);
  });

  it("returns upper-left corner", () => {
    const [x, y] = xy(gt, 0, 0, "ul");
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(200);
  });

  it("returns lower-right corner", () => {
    const [x, y] = xy(gt, 0, 0, "lr");
    expect(x).toBeCloseTo(101);
    expect(y).toBeCloseTo(199);
  });
});

describe("index/xy round-trip", () => {
  const gt: Affine = [0.5, 0, -180, 0, -0.5, 90];

  it("xy then index recovers the original pixel", () => {
    const row = 10;
    const col = 20;
    const [x, y] = xy(gt, row, col, "ul");
    const [rRow, rCol] = index(gt, x, y);
    expect(rRow).toBe(row);
    expect(rCol).toBe(col);
  });
});

// ── isMaskIfd ────────────────────────────────────────────────────────────────

describe("isMaskIfd", () => {
  it("returns true for a mask IFD", () => {
    const image = mockImage({
      width: 256,
      height: 256,
      subFileType: SubFileType.Mask,
      photometric: Photometric.Mask,
    });
    expect(isMaskIfd(image)).toBe(true);
  });

  it("returns false when SubFileType has no mask bit", () => {
    const image = mockImage({
      width: 256,
      height: 256,
      subFileType: SubFileType.ReducedImage,
      photometric: Photometric.Mask,
    });
    expect(isMaskIfd(image)).toBe(false);
  });

  it("returns false when Photometric is not Mask", () => {
    const image = mockImage({
      width: 256,
      height: 256,
      subFileType: SubFileType.Mask,
      photometric: Photometric.MinIsBlack,
    });
    expect(isMaskIfd(image)).toBe(false);
  });

  it("returns true when SubFileType combines ReducedImage + Mask bits", () => {
    const image = mockImage({
      width: 256,
      height: 256,
      subFileType: SubFileType.ReducedImage | SubFileType.Mask,
      photometric: Photometric.Mask,
    });
    expect(isMaskIfd(image)).toBe(true);
  });

  it("returns false when SubFileType is absent (defaults to 0)", () => {
    const image = mockImage({
      width: 256,
      height: 256,
      photometric: Photometric.Mask,
    });
    expect(isMaskIfd(image)).toBe(false);
  });
});

// ── extractGeotransform ──────────────────────────────────────────────────────

describe("extractGeotransform", () => {
  it("extracts a basic north-up geotransform", () => {
    const image = mockImage({
      width: 1000,
      height: 1000,
      origin: [-180, 90, 0],
      resolution: [0.1, -0.1, 0],
    });

    const gt = extractGeotransform(image);
    expect(gt).toEqual([0.1, 0, -180, 0, -0.1, 90]);
  });

  it("extracts rotation from ModelTransformation", () => {
    const mt = new Array(16).fill(0);
    mt[1] = 0.01; // b (row rotation)
    mt[4] = 0.02; // d (column rotation)

    const image = mockImage({
      width: 1000,
      height: 1000,
      origin: [100, 50, 0],
      resolution: [1, -1, 0],
      modelTransformation: mt,
    });

    const gt = extractGeotransform(image);
    expect(gt[1]).toBe(0.01);
    expect(gt[3]).toBe(0.02);
  });
});

// ── Overview ─────────────────────────────────────────────────────────────────

describe("Overview", () => {
  it("exposes image dimensions", () => {
    const image = mockImage({ width: 512, height: 256 });
    const ov = new Overview(image, null, [1, 0, 0, 0, -1, 0]);
    expect(ov.width).toBe(512);
    expect(ov.height).toBe(256);
  });

  it("exposes tile size for tiled images", () => {
    const image = mockImage({
      width: 1024,
      height: 1024,
      tileWidth: 256,
      tileHeight: 256,
      tiled: true,
    });
    const ov = new Overview(image, null, [1, 0, 0, 0, -1, 0]);
    expect(ov.tileWidth).toBe(256);
    expect(ov.tileHeight).toBe(256);
  });

  it("uses image dimensions as tile size for non-tiled images", () => {
    const image = mockImage({
      width: 512,
      height: 256,
      tiled: false,
    });
    const ov = new Overview(image, null, [1, 0, 0, 0, -1, 0]);
    expect(ov.tileWidth).toBe(512);
    expect(ov.tileHeight).toBe(256);
  });

  it("fetchTile returns tile bytes", async () => {
    const image = mockImage({ width: 256, height: 256 });
    const ov = new Overview(image, null, [1, 0, 0, 0, -1, 0]);

    const tile = await ov.fetchTile(0, 0);
    expect(tile).not.toBeNull();
    expect(tile!.x).toBe(0);
    expect(tile!.y).toBe(0);
    expect(tile!.bytes).toBeInstanceOf(ArrayBuffer);
  });

  it("fetchTile returns null for sparse tiles", async () => {
    const image = mockImage({ width: 256, height: 256 });
    (image as any).getTile = async () => null;

    const ov = new Overview(image, null, [1, 0, 0, 0, -1, 0]);
    const tile = await ov.fetchTile(0, 0);
    expect(tile).toBeNull();
  });

  it("fetchTileWithMask returns data and mask", async () => {
    const dataImage = mockImage({ width: 256, height: 256 });
    const maskImage = mockImage({ width: 256, height: 256 });

    const ov = new Overview(dataImage, maskImage, [1, 0, 0, 0, -1, 0]);
    const result = await ov.fetchTileWithMask(0, 0);

    expect(result).not.toBeNull();
    expect(result!.data.bytes).toBeInstanceOf(ArrayBuffer);
    expect(result!.mask).not.toBeNull();
    expect(result!.mask!.bytes).toBeInstanceOf(ArrayBuffer);
  });

  it("fetchTileWithMask returns null mask when no mask image", async () => {
    const dataImage = mockImage({ width: 256, height: 256 });
    const ov = new Overview(dataImage, null, [1, 0, 0, 0, -1, 0]);
    const result = await ov.fetchTileWithMask(0, 0);

    expect(result).not.toBeNull();
    expect(result!.mask).toBeNull();
  });
});

// ── GeoTIFF ──────────────────────────────────────────────────────────────────

describe("GeoTIFF", () => {
  it("throws for empty TIFF", () => {
    const tiff = mockTiff([]);
    expect(() => GeoTIFF.fromTiff(tiff)).toThrow(/does not contain/);
  });

  it("creates a GeoTIFF from a single-image TIFF", () => {
    const primary = mockImage({
      width: 1000,
      height: 1000,
      origin: [0, 0, 0],
      resolution: [1, -1, 0],
      samplesPerPixel: 3,
    });
    const tiff = mockTiff([primary]);
    const geo = GeoTIFF.fromTiff(tiff);

    expect(geo.width).toBe(1000);
    expect(geo.height).toBe(1000);
    expect(geo.count).toBe(3);
    expect(geo.overviews).toHaveLength(0);
    expect(geo.transform).toEqual([1, 0, 0, 0, -1, 0]);
  });

  it("classifies reduced-resolution IFDs as overviews", () => {
    const primary = mockImage({
      width: 1000,
      height: 1000,
      origin: [0, 0, 0],
      resolution: [1, -1, 0],
    });
    const ov1 = mockImage({ width: 500, height: 500 });
    const ov2 = mockImage({ width: 250, height: 250 });

    const tiff = mockTiff([primary, ov1, ov2]);
    const geo = GeoTIFF.fromTiff(tiff);

    expect(geo.overviews).toHaveLength(2);
  });

  it("sorts overviews finest-to-coarsest", () => {
    const primary = mockImage({
      width: 1000,
      height: 1000,
      origin: [0, 0, 0],
      resolution: [1, -1, 0],
    });
    // Insert in reverse order
    const small = mockImage({ width: 125, height: 125 });
    const medium = mockImage({ width: 250, height: 250 });
    const large = mockImage({ width: 500, height: 500 });

    const tiff = mockTiff([primary, small, medium, large]);
    const geo = GeoTIFF.fromTiff(tiff);

    expect(geo.overviews).toHaveLength(3);
    expect(geo.overviews[0]!.width).toBe(500);
    expect(geo.overviews[1]!.width).toBe(250);
    expect(geo.overviews[2]!.width).toBe(125);
  });

  it("separates mask IFDs from data IFDs", () => {
    const primary = mockImage({
      width: 1000,
      height: 1000,
      origin: [0, 0, 0],
      resolution: [1, -1, 0],
    });
    const ov = mockImage({ width: 500, height: 500 });
    const primaryMask = mockImage({
      width: 1000,
      height: 1000,
      subFileType: SubFileType.Mask,
      photometric: Photometric.Mask,
    });
    const ovMask = mockImage({
      width: 500,
      height: 500,
      subFileType: SubFileType.ReducedImage | SubFileType.Mask,
      photometric: Photometric.Mask,
    });

    const tiff = mockTiff([primary, ov, primaryMask, ovMask]);
    const geo = GeoTIFF.fromTiff(tiff);

    // Only one data overview (the mask IFDs are paired, not listed as overviews)
    expect(geo.overviews).toHaveLength(1);
    expect(geo.overviews[0]!.maskImage).not.toBeNull();
  });

  it("scales overview transforms correctly", () => {
    const primary = mockImage({
      width: 1000,
      height: 1000,
      origin: [100, 200, 0],
      resolution: [0.01, -0.01, 0],
    });
    const ov = mockImage({ width: 500, height: 500 });

    const tiff = mockTiff([primary, ov]);
    const geo = GeoTIFF.fromTiff(tiff);

    const ovTransform = geo.overviews[0]!.transform;
    // scale = 1000 / 500 = 2
    expect(ovTransform[0]).toBeCloseTo(0.02); // a * 2
    expect(ovTransform[4]).toBeCloseTo(-0.02); // e * 2
    // Origin unchanged
    expect(ovTransform[2]).toBe(100); // c
    expect(ovTransform[5]).toBe(200); // f
  });

  it("delegates fetchTile to the primary image", async () => {
    const primary = mockImage({
      width: 256,
      height: 256,
      origin: [0, 0, 0],
      resolution: [1, -1, 0],
    });
    const tiff = mockTiff([primary]);
    const geo = GeoTIFF.fromTiff(tiff);

    const tile = await geo.fetchTile(0, 0);
    expect(tile).not.toBeNull();
    expect(tile!.x).toBe(0);
    expect(tile!.y).toBe(0);
  });

  it("exposes nodata", () => {
    const primary = mockImage({
      width: 100,
      height: 100,
      origin: [0, 0, 0],
      resolution: [1, -1, 0],
      noData: -9999,
    });
    const tiff = mockTiff([primary]);
    const geo = GeoTIFF.fromTiff(tiff);
    expect(geo.nodata).toBe(-9999);
  });

  it("exposes epsg", () => {
    const primary = mockImage({
      width: 100,
      height: 100,
      origin: [0, 0, 0],
      resolution: [1, -1, 0],
      epsg: 4326,
    });
    const tiff = mockTiff([primary]);
    const geo = GeoTIFF.fromTiff(tiff);
    expect(geo.epsg).toBe(4326);
  });

  it("exposes bbox", () => {
    const primary = mockImage({
      width: 100,
      height: 100,
      origin: [0, 0, 0],
      resolution: [1, -1, 0],
      bbox: [-180, -90, 180, 90],
    });
    const tiff = mockTiff([primary]);
    const geo = GeoTIFF.fromTiff(tiff);
    expect(geo.bbox).toEqual([-180, -90, 180, 90]);
  });

  it("defaults count to 1 when SamplesPerPixel is absent", () => {
    const primary = mockImage({
      width: 100,
      height: 100,
      origin: [0, 0, 0],
      resolution: [1, -1, 0],
    });
    const tiff = mockTiff([primary]);
    const geo = GeoTIFF.fromTiff(tiff);
    expect(geo.count).toBe(1);
  });
});
