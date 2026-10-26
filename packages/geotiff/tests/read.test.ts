/**
 * Tests for `GeoTIFF.read` and `Overview.read`.
 *
 * Each read is compared with rasterio's read of the same window, built from
 * the fixture's rasterio-generated `.npy` tiles (see
 * integration-rasterio.test.ts).
 */

import { readFile } from "node:fs/promises";
import { compose, translation } from "@developmentseed/affine";
import { describe, expect, it } from "vitest";
import type { RasterTypedArray } from "../src/array.js";
import { toBandSeparate } from "../src/array.js";
import type { Window } from "../src/window.js";
import { WindowError } from "../src/window.js";
import { fixturePath, loadGeoTIFF } from "./helpers.js";
import type { NPYTile } from "./utils/parse-npy.js";
import { parseNPY } from "./utils/parse-npy.js";

/**
 * Read `window` of a rasterio fixture as rasterio does, one array per band,
 * from the fixture's `.npy` tiles.
 *
 * @param options.z 0 for the full-resolution image, `n` for its `n`th
 *   overview.
 * @param options.mask Read the mask instead of the data.
 */
async function rasterioRead(
  name: string,
  {
    z = 0,
    window,
    mask = false,
  }: { z?: number; window: Window; mask?: boolean },
): Promise<RasterTypedArray[]> {
  const tiles = new Map<string, NPYTile>();
  async function loadTile(key: string): Promise<NPYTile> {
    const suffix = `/${mask ? "mask-" : ""}${z}-${key}.npy`;
    const buffer = await readFile(fixturePath(name, "rasterio", suffix));
    return parseNPY(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
    );
  }

  const first = await loadTile("0-0");
  tiles.set("0-0", first);
  // Data tiles are (bands, height, width); mask tiles are (height, width).
  const { shape } = first.header;
  const [tileHeight, tileWidth] = shape.slice(-2) as [number, number];
  const count = shape.length === 3 ? shape[0]! : 1;

  const { colOff, rowOff, width, height } = window;
  const Ctor = first.data.constructor as new (
    length: number,
  ) => RasterTypedArray;
  const bands = Array.from({ length: count }, () => new Ctor(width * height));
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const r = rowOff + row;
      const c = colOff + col;
      const key = `${Math.floor(c / tileWidth)}-${Math.floor(r / tileHeight)}`;
      let tile = tiles.get(key);
      if (tile === undefined) {
        tile = await loadTile(key);
        tiles.set(key, tile);
      }
      for (let b = 0; b < count; b++) {
        bands[b]![row * width + col] =
          tile.data[
            (b * tileHeight + (r % tileHeight)) * tileWidth + (c % tileWidth)
          ]!;
      }
    }
  }
  return bands;
}

describe("GeoTIFF.read", () => {
  it.each([
    { name: "uint8_rgb_deflate_block64_cog", hasMask: false },
    // 265x266 px in 128 px tiles, so the last column and row are clipped.
    { name: "uint8_1band_deflate_block128_unaligned", hasMask: false },
    { name: "int8_3band_zstd_block64", hasMask: false },
    { name: "cog_uint8_rgb_mask", hasMask: true },
  ])("reads the whole image by default ($name)", async ({ name, hasMask }) => {
    const geotiff = await loadGeoTIFF(name, "rasterio");
    const window = {
      colOff: 0,
      rowOff: 0,
      width: geotiff.width,
      height: geotiff.height,
    };

    const array = await geotiff.read();

    expect(array.width).toBe(geotiff.width);
    expect(array.height).toBe(geotiff.height);
    expect(array.transform).toEqual(geotiff.transform);
    expect(toBandSeparate(array).bands).toEqual(
      await rasterioRead(name, { window }),
    );
    const mask = hasMask
      ? (await rasterioRead(name, { window, mask: true }))[0]
      : null;
    expect(array.mask).toEqual(mask);
  });

  it("reads a window that spans several tiles", async () => {
    // 128x128 px in 64 px tiles: the window starts and ends mid-tile, in 2x2
    // tiles.
    const name = "uint8_rgb_deflate_block64_cog";
    const geotiff = await loadGeoTIFF(name, "rasterio");
    const window = { colOff: 32, rowOff: 16, width: 64, height: 80 };

    const array = await geotiff.read({ window });

    expect(array.width).toBe(64);
    expect(array.height).toBe(80);
    expect(array.count).toBe(3);
    expect(array.transform).toEqual(
      compose(geotiff.transform, translation(32, 16)),
    );
    expect(array.crs).toEqual(geotiff.crs);
    expect(array.nodata).toBe(geotiff.nodata);
    expect(toBandSeparate(array).bands).toEqual(
      await rasterioRead(name, { window }),
    );
  });

  it("reads a window inside one tile", async () => {
    const name = "uint8_rgb_deflate_block64_cog";
    const geotiff = await loadGeoTIFF(name, "rasterio");
    // Inside tile (1, 0).
    const window = { colOff: 70, rowOff: 10, width: 20, height: 30 };

    const array = await geotiff.read({ window });

    expect(array.width).toBe(20);
    expect(array.height).toBe(30);
    expect(array.transform).toEqual(
      compose(geotiff.transform, translation(70, 10)),
    );
    expect(toBandSeparate(array).bands).toEqual(
      await rasterioRead(name, { window }),
    );
  });

  it("reads a window of a band-separate image", async () => {
    const name = "int8_3band_zstd_block64";
    const geotiff = await loadGeoTIFF(name, "rasterio");
    const window = { colOff: 40, rowOff: 50, width: 60, height: 70 };

    const array = await geotiff.read({ window });

    expect(array.layout).toBe("band-separate");
    expect(toBandSeparate(array).bands).toEqual(
      await rasterioRead(name, { window }),
    );
  });

  it("reads the mask of a window that reaches clipped edge tiles", async () => {
    // 300x302 px in 128 px tiles, with a mask. The window spans 3x3 tiles and
    // ends at the image's right and bottom edges.
    const name = "uint8_1band_deflate_block128_unaligned_mask";
    const geotiff = await loadGeoTIFF(name, "rasterio");
    const window = { colOff: 120, rowOff: 100, width: 180, height: 202 };

    const array = await geotiff.read({ window });

    expect(toBandSeparate(array).bands).toEqual(
      await rasterioRead(name, { window }),
    );
    expect(array.mask).toEqual(
      (await rasterioRead(name, { window, mask: true }))[0],
    );
  });

  it.each([
    {
      about: "past the right edge",
      window: { colOff: 100, rowOff: 0, width: 29, height: 10 },
    },
    {
      about: "past the bottom edge",
      window: { colOff: 0, rowOff: 120, width: 10, height: 9 },
    },
    {
      about: "with a negative offset",
      window: { colOff: -1, rowOff: 0, width: 10, height: 10 },
    },
    {
      about: "with zero width",
      window: { colOff: 0, rowOff: 0, width: 0, height: 10 },
    },
    {
      about: "with a fractional offset",
      window: { colOff: 0.5, rowOff: 0, width: 10, height: 10 },
    },
  ])("rejects a window $about", async ({ window }) => {
    // 128x128 px.
    const geotiff = await loadGeoTIFF(
      "uint8_rgb_deflate_block64_cog",
      "rasterio",
    );
    await expect(geotiff.read({ window })).rejects.toThrow(WindowError);
  });

  it("rejects with the reason of an aborted signal", async () => {
    const geotiff = await loadGeoTIFF(
      "uint8_rgb_deflate_block64_cog",
      "rasterio",
    );
    const controller = new AbortController();
    const reason = new Error("read cancelled");
    controller.abort(reason);

    await expect(geotiff.read({ signal: controller.signal })).rejects.toBe(
      reason,
    );
  });
});

describe("Overview.read", () => {
  it("reads the whole overview by default", async () => {
    // A 128x128 px overview of a 256x256 px image, in 64 px tiles.
    const name = "cog_uint8_rgb_nodata";
    const overview = (await loadGeoTIFF(name, "rasterio")).overviews[0]!;
    const window = { colOff: 0, rowOff: 0, width: 128, height: 128 };

    const array = await overview.read();

    expect(array.width).toBe(128);
    expect(array.height).toBe(128);
    expect(array.transform).toEqual(overview.transform);
    expect(toBandSeparate(array).bands).toEqual(
      await rasterioRead(name, { z: 1, window }),
    );
  });

  it("reads a window of an overview", async () => {
    // A 133x133 px overview in 128 px tiles: the window spans 2x2 tiles and
    // ends at the overview's clipped right and bottom edges.
    const name = "uint8_1band_deflate_block128_unaligned";
    const overview = (await loadGeoTIFF(name, "rasterio")).overviews[0]!;
    const window = { colOff: 100, rowOff: 90, width: 33, height: 43 };

    const array = await overview.read({ window });

    expect(array.transform).toEqual(
      compose(overview.transform, translation(100, 90)),
    );
    expect(toBandSeparate(array).bands).toEqual(
      await rasterioRead(name, { z: 1, window }),
    );
  });

  it("rejects a window outside the overview but inside the full image", async () => {
    // A 128x128 px overview of a 256x256 px image.
    const overview = (await loadGeoTIFF("cog_uint8_rgb_nodata", "rasterio"))
      .overviews[0]!;
    const window = { colOff: 0, rowOff: 0, width: 129, height: 1 };

    await expect(overview.read({ window })).rejects.toThrow(WindowError);
  });
});
