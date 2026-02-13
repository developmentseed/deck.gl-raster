import { TiffTag } from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import { decode } from "../src/decode/api.js";
import { loadGeoTIFF } from "./helpers.js";

describe("decode", () => {
  it("can decompress deflate-compressed tile data", async () => {
    const tiff = await loadGeoTIFF("uint8_rgb_deflate_block64_cog", "rasterio");
    const image = tiff.tiff.images[0]!;
    const tile = await image.getTile(0, 0);
    expect(tile).not.toBeNull();

    const result = await decode(tile!.bytes, tile!.compression);

    const { width, height } = image.tileSize;
    const samplesPerPixel = image.value(TiffTag.SamplesPerPixel) as number;
    const bitsPerSample = (image.value(TiffTag.BitsPerSample) as number[])[0]!;
    const bytesPerSample = bitsPerSample / 8;
    const expectedBytes = width * height * samplesPerPixel * bytesPerSample;

    expect(result.layout).toBe("pixel-interleaved");
    if (result.layout === "pixel-interleaved") {
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.data.byteLength).toBe(expectedBytes);
    }
  });

  it("can decompress lerc-compressed tile data", async () => {
    const tiff = await loadGeoTIFF("float32_1band_lerc_block32", "rasterio");
    const image = tiff.tiff.images[0]!;
    const tile = await image.getTile(0, 0);
    expect(tile).not.toBeNull();

    const result = await decode(tile!.bytes, tile!.compression);

    const { width, height } = image.tileSize;
    const samplesPerPixel = image.value(TiffTag.SamplesPerPixel) as number;
    const bitsPerSample = (image.value(TiffTag.BitsPerSample) as number[])[0]!;
    const bytesPerSample = bitsPerSample / 8;
    const expectedBytesPerBand = width * height * bytesPerSample;

    expect(result.layout).toBe("band-separate");
    if (result.layout === "band-separate") {
      expect(result.bands).toHaveLength(samplesPerPixel);
      expect(result.bands[0]).toBeInstanceOf(Float32Array);
      expect(result.bands[0]!.byteLength).toBe(expectedBytesPerBand);
    }
  });
});
