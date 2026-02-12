import { Photometric, SubFileType } from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import { extractGeotransform, GeoTIFF, isMaskIfd } from "../src/geotiff.js";
import { mockImage, mockTiff } from "./helpers.js";

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
