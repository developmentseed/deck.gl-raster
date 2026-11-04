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
    } = tiff.cachedPrimaryImageTags;
    const { width, height } = image.tileSize;

    const result = await decode(tile!.bytes, tile!.compression, {
      sampleFormat: sampleFormat[0]!,
      bitsPerSample: bitsPerSample[0]!,
      samplesPerPixel,
      width,
      height,
      predictor,
      planarConfiguration,
      littleEndian: tiff.tiff.isLittleEndian,
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
      tiff.cachedPrimaryImageTags;
    const { width, height } = image.tileSize;

    // This fixture is band-separate, so each raw tile contains a single band.
    const tileSamplesPerPixel =
      planarConfiguration === PlanarConfiguration.Separate
        ? 1
        : tiff.cachedPrimaryImageTags.samplesPerPixel;

    const result = await decode(tile!.bytes, tile!.compression, {
      sampleFormat: sampleFormat[0]!,
      bitsPerSample: bitsPerSample[0]!,
      samplesPerPixel: tileSamplesPerPixel,
      width,
      height,
      predictor,
      planarConfiguration,
      littleEndian: tiff.tiff.isLittleEndian,
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
    } = tiff.cachedPrimaryImageTags;
    const { width, height } = image.tileSize;

    const result = await decode(tile!.bytes, tile!.compression, {
      sampleFormat: sampleFormat[0]!,
      bitsPerSample: bitsPerSample[0]!,
      samplesPerPixel,
      width,
      height,
      predictor,
      planarConfiguration,
      littleEndian: tiff.tiff.isLittleEndian,
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

  it("swaps samples decoded from LERC", async () => {
    // libtiff swaps samples into the file's byte order before LERC encodes
    // them, so the same LERC data in an MM file holds byte-swapped values.
    const tiff = await loadGeoTIFF("float32_1band_lerc_block32", "rasterio");
    const image = tiff.tiff.images[0]!;
    const tile = await image.getTile(0, 0);
    const { width, height } = image.tileSize;
    const metadata = {
      sampleFormat: SampleFormat.Float,
      bitsPerSample: 32,
      samplesPerPixel: 1,
      width,
      height,
      predictor: Predictor.None,
      planarConfiguration: PlanarConfiguration.Contig,
      lercParameters: tiff.cachedPrimaryImageTags.lercParameters,
    };

    const bandBytes = async (littleEndian: boolean) => {
      const result = await decode(tile!.bytes, tile!.compression, {
        ...metadata,
        littleEndian,
      });
      if (result.layout !== "band-separate") {
        throw new Error("expected band-separate output");
      }
      const band = result.bands[0]!;
      return new Uint8Array(band.buffer, band.byteOffset, band.byteLength);
    };
    const little = await bandBytes(true);
    const big = await bandBytes(false);

    const expected = new Uint8Array(little.length);
    for (let i = 0; i < little.length; i += 4) {
      expected.set(little.subarray(i, i + 4).reverse(), i);
    }
    expect(big).toEqual(expected);
  });
});

describe("decode LERC tiles with NaN pixels", () => {
  // LERC data of 4x4 float strips that GDAL 3.12.1 wrote with COMPRESS=LERC,
  // MAX_Z_ERROR=0 and INTERLEAVE=PIXEL. Band b, pixel i holds b * 16 + i + 1.

  // One band, NaN at pixels 1, 7 and 10.
  const ONE_BAND_F32 =
    "TGVyYzIgBAAAAPThprgEAAAABAAAAAEAAAANAAAACAAAAIkAAAAGAAAAAAAAAAAAAAAAAAAAAADwPwAAAAAAADBABgAAAAIAvt8AgAAAgD8AAIBBAQAAgD8AAEBAAACAQAAAoEAAAMBAAADgQAAAEEEAACBBAABAQQAAUEEAAGBBAABwQQAAgEE=";
  // Same as ONE_BAND_F32, as float64.
  const ONE_BAND_F64 =
    "TGVyYzIgBAAAANY0cgoEAAAABAAAAAEAAAANAAAACAAAAMUAAAAHAAAAAAAAAAAAAAAAAAAAAADwPwAAAAAAADBABgAAAAIAvt8AgAAAAAAAAPA/AAAAAAAAMEABAAAAAAAA8D8AAAAAAAAIQAAAAAAAABBAAAAAAAAAFEAAAAAAAAAYQAAAAAAAABxAAAAAAAAAIkAAAAAAAAAkQAAAAAAAAChAAAAAAAAAKkAAAAAAAAAsQAAAAAAAAC5AAAAAAAAAMEA=";
  // Two bands, NaN in both samples of pixels 2 and 13.
  const TWO_BANDS_SHARED_NAN =
    "TGVyYzIgBAAAAOC6EjQEAAAABAAAAAIAAAAOAAAACAAAAM0AAAAGAAAAAAAAAAAAAAAAAAAAAADwPwAAAAAAAEBABgAAAAIA3/sAgAAAgD8AAIhBAACAQQAAAEIBAACAPwAAiEEAAABAAACQQQAAgEAAAKBBAACgQAAAqEEAAMBAAACwQQAA4EAAALhBAAAAQQAAwEEAABBBAADIQQAAIEEAANBBAAAwQQAA2EEAAEBBAADgQQAAUEEAAOhBAABwQQAA+EEAAIBBAAAAQg==";
  // Two bands, NaN at pixels 0 and 5 of band 0 and pixels 5 and 15 of band 1.
  const TWO_BANDS_SEPARATE_NAN =
    "TGVyYzIgBAAAAAV2O2oEAAAABAAAAAEAAAAOAAAACAAAAI0AAAAGAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAADBABgAAAAIAe/8AgAAAAEAAAIBBAQAAAEAAAEBAAACAQAAAoEAAAOBAAAAAQQAAEEEAACBBAAAwQQAAQEEAAFBBAABgQQAAcEEAAIBBTGVyYzIgBAAAABdBhD8EAAAABAAAAAEAAAAOAAAACAAAAI0AAAAGAAAAAAAAAAAAAAAAAAAAAAAxQAAAAAAAAD9ABgAAAAIA+/4AgAAAiEEAAPhBAQAAiEEAAJBBAACYQQAAoEEAAKhBAAC4QQAAwEEAAMhBAADQQQAA2EEAAOBBAADoQQAA8EEAAPhB";
  // One band, every pixel NaN.
  const ALL_NAN =
    "TGVyYzIgBAAAAABdBtwEAAAABAAAAAEAAAAAAAAACAAAAEYAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

  /** Decode one of the base64 LERC strips above. */
  function decodeStrip(
    base64: string,
    { bitsPerSample = 32, samplesPerPixel = 1, littleEndian = true } = {},
  ) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return decode(bytes.buffer, Compression.Lerc, {
      sampleFormat: SampleFormat.Float,
      bitsPerSample,
      samplesPerPixel,
      width: 4,
      height: 4,
      predictor: Predictor.None,
      planarConfiguration: PlanarConfiguration.Contig,
      littleEndian,
    });
  }

  /**
   * All decoded samples in band-major order. LERC returns the samples of a
   * pixel either as separate bands or as one depth-major array.
   */
  function bandMajor(result: Awaited<ReturnType<typeof decode>>): number[] {
    if (result.layout !== "band-separate") {
      throw new Error("expected band-separate output");
    }
    return result.bands.flatMap((band) => Array.from(band));
  }

  it.each([
    { name: "float32", base64: ONE_BAND_F32, bitsPerSample: 32 },
    { name: "float64", base64: ONE_BAND_F64, bitsPerSample: 64 },
  ])("sets invalid $name pixels to NaN", async ({ base64, bitsPerSample }) => {
    const result = await decodeStrip(base64, { bitsPerSample });
    // biome-ignore format: array
    const expected = [
      1, NaN, 3, 4,
      5, 6, 7, NaN,
      9, 10, NaN, 12,
      13, 14, 15, 16,
    ];
    expect(bandMajor(result)).toEqual(expected);
  });

  it("sets every sample of an invalid pixel to NaN", async () => {
    // GDAL writes one mask for all samples when no pixel is NaN in only some.
    const result = await decodeStrip(TWO_BANDS_SHARED_NAN, {
      samplesPerPixel: 2,
    });
    // biome-ignore format: array
    const expected = [
      // band 0
      1, 2, NaN, 4,
      5, 6, 7, 8,
      9, 10, 11, 12,
      13, NaN, 15, 16,
      // band 1
      17, 18, NaN, 20,
      21, 22, 23, 24,
      25, 26, 27, 28,
      29, NaN, 31, 32,
    ];
    expect(bandMajor(result)).toEqual(expected);
  });

  it("applies each band's own mask", async () => {
    // GDAL writes one mask per band when a pixel is NaN in only some samples.
    const result = await decodeStrip(TWO_BANDS_SEPARATE_NAN, {
      samplesPerPixel: 2,
    });
    // biome-ignore format: array
    const expected = [
      // band 0
      NaN, 2, 3, 4,
      5, NaN, 7, 8,
      9, 10, 11, 12,
      13, 14, 15, 16,
      // band 1
      17, 18, 19, 20,
      21, NaN, 23, 24,
      25, 26, 27, 28,
      29, 30, 31, NaN,
    ];
    expect(bandMajor(result)).toEqual(expected);
  });

  it("sets every pixel of an all-NaN tile to NaN", async () => {
    const result = await decodeStrip(ALL_NAN);
    expect(bandMajor(result)).toEqual(new Array(16).fill(NaN));
  });

  it("fills NaN before swapping big endian samples, as libtiff does", async () => {
    // GDAL reads these pixels of a big endian file as NaN with its bytes
    // reversed: libtiff fills NaN in the file's byte order, then swaps.
    const result = await decodeStrip(ONE_BAND_F32, { littleEndian: false });
    const nanBytes = new Uint8Array([0x7f, 0xc0, 0x00, 0x00]);
    const swappedNaN = new DataView(nanBytes.buffer).getFloat32(0, true);
    const values = bandMajor(result);
    expect([values[1], values[7], values[10]]).toEqual([
      swappedNaN,
      swappedNaN,
      swappedNaN,
    ]);
  });
});
