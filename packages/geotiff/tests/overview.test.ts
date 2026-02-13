import { describe, expect, it } from "vitest";
import { Overview } from "../src/overview.js";
import { mockImage } from "./helpers.js";

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
