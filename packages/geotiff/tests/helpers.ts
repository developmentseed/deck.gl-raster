import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Source, Tiff, TiffImage } from "@cogeotiff/core";
import { SampleFormat, TiffTag } from "@cogeotiff/core";
import { GeoTIFF } from "../src/geotiff.js";

/** File-based Source for integration tests
 *
 * Reads a local file into memory, then serves byte-range fetches from the
 * buffer.
 */
export class FileSource implements Source {
  url: URL;
  private data: Promise<Buffer>;

  constructor(filePath: string) {
    this.url = new URL(`file://${filePath}`);
    this.data = readFile(filePath);
  }

  async fetch(offset: number, length?: number): Promise<ArrayBuffer> {
    const buf = await this.data;
    const end = length != null ? offset + length : undefined;
    const slice = buf.subarray(offset, end);
    const arrayBuffer = slice.buffer.slice(
      slice.byteOffset,
      slice.byteOffset + slice.byteLength,
    );
    if (arrayBuffer instanceof SharedArrayBuffer) {
      throw new Error("Expected ArrayBuffer, got SharedArrayBuffer");
    }
    return arrayBuffer;
  }
}

// ── Fixture helpers ─────────────────────────────────────────────────────

const FIXTURES_DIR = resolve(
  import.meta.dirname,
  "../../../fixtures/geotiff-test-data",
);

/**
 * Resolve a test fixture path.
 * @param name - filename without extension (e.g. "uint8_rgb_deflate_block64_cog")
 * @param variant - "rasterio" (default) or a real_data subdirectory name
 */
export function fixturePath(name: string, variant: string): string {
  if (variant === "rasterio") {
    return resolve(FIXTURES_DIR, "rasterio_generated/fixtures", `${name}.tif`);
  }
  return resolve(FIXTURES_DIR, "real_data", variant, `${name}.tif`);
}

/** Open a GeoTIFF test fixture by name. */
export async function loadGeoTIFF(
  name: string,
  variant: string,
): Promise<GeoTIFF> {
  const path = fixturePath(name, variant);
  const source = new FileSource(path);
  return GeoTIFF.open(source);
}

// ── Mock helpers ────────────────────────────────────────────────────────

/** Create a mock TiffImage with configurable properties. */
export function mockImage(opts: {
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

  // Default SampleFormat and BitsPerSample so fetchTile works
  if (!tags.has(TiffTag.SampleFormat)) {
    tags.set(TiffTag.SampleFormat, [SampleFormat.Uint]);
  }
  if (!tags.has(TiffTag.BitsPerSample)) {
    tags.set(TiffTag.BitsPerSample, [8]);
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
    init: async () => {},
    has: (tag: number) => tags.has(tag),
    value: (tag: number) => {
      if (tags.has(tag)) return tags.get(tag);
      return null;
    },
    valueGeo: () => null,
    fetch: async (tag: number) => tags.get(tag) ?? null,
    getTile: async (_x: number, _y: number) => ({
      bytes: new ArrayBuffer(
        (opts.tileWidth ?? 256) *
          (opts.tileHeight ?? 256) *
          (opts.samplesPerPixel ?? 1),
      ),
      mimeType: "application/octet-stream",
      compression: 1, // None
    }),
  } as unknown as TiffImage;
}

/** Create a mock Tiff with the given images. */
export function mockTiff(images: TiffImage[]): Tiff {
  return { images } as unknown as Tiff;
}
