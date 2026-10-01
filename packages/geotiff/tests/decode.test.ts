import {
  Compression,
  PlanarConfiguration,
  Predictor,
  SampleFormat,
} from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import { decode } from "../src/decode.js";
import { loadGeoTIFF } from "./helpers.js";

describe("decode", () => {
  it("can decompress deflate-compressed tile data", async () => {
    const tiff = await loadGeoTIFF("uint8_rgb_deflate_block64_cog", "rasterio");
    const image = tiff.tiff.images[0]!;
    const tile = await image.getTile(0, 0);
    expect(tile).not.toBeNull();

    const {
      bitsPerSample,
      sampleFormat,
      samplesPerPixel,
      predictor,
      planarConfiguration,
    } = tiff.cachedTags;
    const { width, height } = image.tileSize;

    const result = await decode(tile!.bytes, tile!.compression, {
      sampleFormat: sampleFormat[0]!,
      bitsPerSample: bitsPerSample[0]!,
      samplesPerPixel,
      width,
      height,
      predictor,
      planarConfiguration,
    });

    const bytesPerSample = bitsPerSample[0]! / 8;
    const expectedBytes = width * height * samplesPerPixel * bytesPerSample;

    expect(result.layout).toBe("pixel-interleaved");
    if (result.layout === "pixel-interleaved") {
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.data.byteLength).toBe(expectedBytes);
    }
  });

  it("can decompress zstd-compressed tile data", async () => {
    const tiff = await loadGeoTIFF("int8_3band_zstd_block64", "rasterio");
    const image = tiff.tiff.images[0]!;
    const tile = await image.getTile(0, 0);
    expect(tile).not.toBeNull();

    const { bitsPerSample, sampleFormat, predictor, planarConfiguration } =
      tiff.cachedTags;
    const { width, height } = image.tileSize;

    // This fixture is band-separate, so each raw tile contains a single band.
    const tileSamplesPerPixel =
      planarConfiguration === PlanarConfiguration.Separate
        ? 1
        : tiff.cachedTags.samplesPerPixel;

    const result = await decode(tile!.bytes, tile!.compression, {
      sampleFormat: sampleFormat[0]!,
      bitsPerSample: bitsPerSample[0]!,
      samplesPerPixel: tileSamplesPerPixel,
      width,
      height,
      predictor,
      planarConfiguration,
    });

    const bytesPerSample = bitsPerSample[0]! / 8;
    const expectedBytes = width * height * tileSamplesPerPixel * bytesPerSample;

    expect(result.layout).toBe("pixel-interleaved");
    if (result.layout === "pixel-interleaved") {
      expect(result.data).toBeInstanceOf(Int8Array);
      expect(result.data.byteLength).toBe(expectedBytes);
    }
  });

  it("can decompress lerc-compressed tile data", async () => {
    const tiff = await loadGeoTIFF("float32_1band_lerc_block32", "rasterio");
    const image = tiff.tiff.images[0]!;
    const tile = await image.getTile(0, 0);
    expect(tile).not.toBeNull();

    const {
      bitsPerSample,
      sampleFormat,
      samplesPerPixel,
      predictor,
      planarConfiguration,
    } = tiff.cachedTags;
    const { width, height } = image.tileSize;

    const result = await decode(tile!.bytes, tile!.compression, {
      sampleFormat: sampleFormat[0]!,
      bitsPerSample: bitsPerSample[0]!,
      samplesPerPixel,
      width,
      height,
      predictor,
      planarConfiguration,
    });

    const bytesPerSample = bitsPerSample[0]! / 8;
    const expectedBytesPerBand = width * height * bytesPerSample;

    expect(result.layout).toBe("band-separate");
    if (result.layout === "band-separate") {
      expect(result.bands).toHaveLength(samplesPerPixel);
      expect(result.bands[0]).toBeInstanceOf(Float32Array);
      expect(result.bands[0]!.byteLength).toBe(expectedBytesPerBand);
    }
  });
});

describe("decode big endian tiles", () => {
  // Float32 values whose bytes are not palindromic, so a wrong byte order shows.
  const floats = [0.5053, -12.25, 1e10, 0.4906];

  function floatMetadata(predictor: Predictor, littleEndian: boolean) {
    return {
      sampleFormat: SampleFormat.Float,
      bitsPerSample: 32,
      samplesPerPixel: 1,
      width: floats.length,
      height: 1,
      predictor,
      planarConfiguration: PlanarConfiguration.Contig,
      littleEndian,
    };
  }

  function pixels(result: Awaited<ReturnType<typeof decode>>) {
    if (result.layout !== "pixel-interleaved") {
      throw new Error("expected pixel-interleaved output");
    }
    return Array.from(result.data);
  }

  it("swaps samples without a predictor", async () => {
    const bytes = new ArrayBuffer(floats.length * 4);
    const view = new DataView(bytes);
    floats.forEach((v, i) => {
      view.setFloat32(i * 4, v, false);
    });
    const original = new Uint8Array(bytes).slice();

    const result = await decode(
      bytes,
      Compression.None,
      floatMetadata(Predictor.None, false),
    );

    expect(pixels(result)).toEqual(Array.from(Float32Array.from(floats)));
    // The caller's buffer may be shared with a block cache.
    expect(new Uint8Array(bytes)).toEqual(original);
  });

  it("swaps samples before undoing horizontal differencing", async () => {
    const values = [258, 300, 1000, 65000];
    const bytes = new ArrayBuffer(values.length * 2);
    const view = new DataView(bytes);
    values.forEach((v, i) => {
      const diff = i === 0 ? v : (v - values[i - 1]!) & 0xffff;
      view.setUint16(i * 2, diff, false);
    });

    const result = await decode(bytes, Compression.None, {
      sampleFormat: SampleFormat.Uint,
      bitsPerSample: 16,
      samplesPerPixel: 1,
      width: values.length,
      height: 1,
      predictor: Predictor.Horizontal,
      planarConfiguration: PlanarConfiguration.Contig,
      littleEndian: false,
    });

    expect(pixels(result)).toEqual(values);
  });

  it("does not swap floating point predictor byte planes", async () => {
    // Predictor 3 stores byte planes most significant byte first whatever the
    // file's byte order, so the same bytes must decode the same in II and MM.
    const n = floats.length;
    const sample = new DataView(new ArrayBuffer(4));
    const encoded = new Uint8Array(n * 4);
    floats.forEach((v, i) => {
      sample.setFloat32(0, v, false);
      for (let plane = 0; plane < 4; plane++) {
        encoded[plane * n + i] = sample.getUint8(plane);
      }
    });
    for (let i = encoded.length - 1; i > 0; i--) {
      encoded[i] = (encoded[i]! - encoded[i - 1]!) & 0xff;
    }
    const expected = Array.from(Float32Array.from(floats));

    for (const littleEndian of [true, false]) {
      const result = await decode(
        encoded.slice().buffer,
        Compression.None,
        floatMetadata(Predictor.FloatingPoint, littleEndian),
      );
      expect(pixels(result)).toEqual(expected);
    }
  });
});
