/**
 * Integration tests: compare our GeoTIFF output against geotiff.js.
 *
 * geotiff.js is the de-facto reference implementation for reading GeoTIFFs in
 * JavaScript, so we use it as a ground truth for pixel values, dimensions, and
 * georeferencing.
 *
 * Fixtures that require unsupported codecs (WebP, JPEG, LZW, LZMA, JXL,
 * zstd) are intentionally omitted here.
 */

import type { GeoTIFFImage, GeoTIFF as GeotiffJs } from "geotiff";
import { fromFile } from "geotiff";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toBandSeparate } from "../src/array.js";
import type { GeoTIFF } from "../src/geotiff.js";
import { fixturePath, loadGeoTIFF } from "./helpers.js";

const FIXTURES = [
  { variant: "rasterio", name: "uint8_rgb_deflate_block64_cog" },
  { variant: "rasterio", name: "uint8_1band_deflate_block128_unaligned" },
  { variant: "rasterio", name: "float32_1band_lerc_block32" },
  { variant: "rasterio", name: "uint16_1band_lzw_block128_predictor2" },
  { variant: "rasterio", name: "uint8_1band_lzw_block64_predictor2" },
  { variant: "nlcd", name: "nlcd_landcover" },
  // sydney_airport_GEC: no ModelTiepoint/ModelPixelScale/ModelTransformation — geo transform stored as GCPs, not readable by @cogeotiff/core
  // float32_1band_lerc_deflate_block32: geotiff.js does not support LERC_DEFLATE
] as const;

// The unaligned fixture: 265×266, 128×128 tiles — right edge is 9px, bottom is 10px.
const UNALIGNED_EDGE_W = 265 % 128; // 9
const UNALIGNED_EDGE_H = 266 % 128; // 10

/** Open the same file with geotiff.js. */
async function loadGeoTiffJs(
  name: string,
  variant: string,
): Promise<GeotiffJs> {
  return fromFile(fixturePath(name, variant));
}

/** Assert two typed arrays are element-wise close (for floats). */
function expectArraysClose(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  tolerance = 1e-5,
): void {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > tolerance) {
      throw new Error(
        `Arrays differ at index ${i}: ${a[i]} vs ${b[i]} (tolerance ${tolerance})`,
      );
    }
  }
}

describe("integration vs geotiff.js", () => {
  for (const { variant, name } of FIXTURES) {
    describe(`${variant}/${name}`, () => {
      let ours: GeoTIFF;
      let refImage: GeoTIFFImage;
      let ref: GeotiffJs;

      beforeAll(async () => {
        ours = await loadGeoTIFF(name, variant);
        ref = await loadGeoTiffJs(name, variant);
        refImage = await ref.getImage();
      });

      afterAll(() => ref.close());

      it("dimensions match", () => {
        expect(ours.width).toBe(refImage.getWidth());
        expect(ours.height).toBe(refImage.getHeight());
        expect(ours.count).toBe(refImage.getSamplesPerPixel());
        expect(ours.tileWidth).toBe(refImage.getTileWidth());
        expect(ours.tileHeight).toBe(refImage.getTileHeight());
      });

      it("georeferencing transform matches", () => {
        // geotiff.js exposes [xOrigin, yOrigin, zOrigin]
        const [refOriginX, refOriginY] = refImage.getOrigin();
        // geotiff.js exposes [xRes, yRes, zRes] — signed (negative = north-up)
        const [refResX, refResY] = refImage.getResolution();

        const [a, , c, , e, f] = ours.transform; // [a, b, c, d, e, f]

        expect(c).toBeCloseTo(refOriginX!, 6);
        expect(f).toBeCloseTo(refOriginY!, 6);
        expect(a).toBeCloseTo(refResX!, 6);
        expect(e).toBeCloseTo(refResY!, 6);
      });

      it("tile (0,0) pixel data matches", async () => {
        const tw = ours.tileWidth;
        const th = ours.tileHeight;

        const tile = await ours.fetchTile(0, 0);
        const oursBandSep = toBandSeparate(tile.array);

        // readRasters returns band-separate by default
        const refData = await refImage.readRasters({ window: [0, 0, tw, th] });

        expect(oursBandSep.bands.length).toBe(ours.count);
        expect(refData.length).toBe(ours.count);

        const isFloat =
          oursBandSep.bands[0] instanceof Float32Array ||
          oursBandSep.bands[0] instanceof Float64Array;

        for (let b = 0; b < ours.count; b++) {
          const ourBand = oursBandSep.bands[b]!;
          const refBand = refData[b] as ArrayLike<number>;
          if (isFloat) {
            expectArraysClose(ourBand, refBand);
          } else {
            expect(ourBand).toEqual(refBand);
          }
        }
      });
    });
  }
});

describe("boundless=false edge tile pixel values", () => {
  let ours: GeoTIFF;
  let ref: GeotiffJs;
  let refImage: GeoTIFFImage;

  beforeAll(async () => {
    ours = await loadGeoTIFF("uint8_1band_deflate_block128_unaligned", "rasterio");
    ref = await loadGeoTiffJs("uint8_1band_deflate_block128_unaligned", "rasterio");
    refImage = await ref.getImage();
  });

  afterAll(() => ref.close());

  it("corner tile (2,2) pixel values match geotiff.js readRasters window", async () => {
    const tile = await ours.fetchTile(2, 2, { boundless: false });
    const { array } = tile;

    expect(array.width).toBe(UNALIGNED_EDGE_W);
    expect(array.height).toBe(UNALIGNED_EDGE_H);

    const left = 2 * ours.tileWidth;
    const top = 2 * ours.tileHeight;
    const right = left + UNALIGNED_EDGE_W;
    const bottom = top + UNALIGNED_EDGE_H;

    const refData = await refImage.readRasters({ window: [left, top, right, bottom] });
    const oursBandSep = toBandSeparate(array);

    for (let b = 0; b < ours.count; b++) {
      expect(oursBandSep.bands[b]).toEqual(refData[b] as ArrayLike<number>);
    }
  });
});
