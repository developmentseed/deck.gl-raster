import { describe, expect, it } from "vitest";
import type { LoadProgress } from "../src/scene/load.js";
import { checkImage, loadImage } from "../src/scene/load.js";
import { fakeGeoTIFF } from "./fake-image.js";

describe("checkImage", () => {
  it("names the field when the file has changed", () => {
    const { geotiff } = fakeGeoTIFF({
      transform: [10000, 0, 300000, 0, -10000, 6200000],
    });
    expect(() => checkImage(geotiff)).toThrow(
      /antimeridian_UTM_60N\.tif: expected pixel size 20000, got 10000/,
    );
  });
});

describe("loadImage", () => {
  it("reads the 42 x 42 image once, unpadded", async () => {
    const { geotiff, calls } = fakeGeoTIFF();
    const image = await loadImage({ open: async () => geotiff });
    expect([image.width, image.height]).toEqual([42, 42]);
    expect(image.values.length).toBe(42 * 42);
    expect(calls).toEqual([{ xy: [[0, 0]], boundless: false }]);
  });

  it("reports the header and the pixels as they arrive", async () => {
    const { geotiff } = fakeGeoTIFF();
    const reports: LoadProgress[] = [];
    await loadImage({
      open: async () => geotiff,
      onProgress: (progress) => reports.push(progress),
    });
    expect(reports).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
  });

  it("names the file when it can't be read", async () => {
    const { geotiff } = fakeGeoTIFF({}, new Error("network down"));
    await expect(loadImage({ open: async () => geotiff })).rejects.toThrow(
      /Couldn't load antimeridian_UTM_60N\.tif: network down/,
    );
  });
});

describe("loadImage at a slow venue", () => {
  it("gives up after a while, naming the file", async () => {
    await expect(
      loadImage({ open: () => new Promise(() => {}), timeoutMs: 20 }),
    ).rejects.toThrow(
      /Couldn't load antimeridian_UTM_60N\.tif: timed out after 0\.02 s/,
    );
  });
});
