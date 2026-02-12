import type { Tiff, TiffImage } from "@cogeotiff/core";
import { TiffTag } from "@cogeotiff/core";

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
export function mockTiff(images: TiffImage[]): Tiff {
  return { images } as unknown as Tiff;
}
