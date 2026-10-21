import type { Affine } from "@developmentseed/affine";
import type { Tile } from "@developmentseed/geotiff";
import { GeoTIFF } from "@developmentseed/geotiff";
import { FIXTURE_FILE, FIXTURE_URL, IMAGE } from "./constants.js";

/** The image's pixels and georeferencing, as read from the file. */
export type SourceImage = {
  /** One value per pixel, row by row. */
  values: Uint8Array;
  width: number;
  height: number;
  /** Pixel to source CRS (UTM 60N metres). */
  transform: Affine;
  /** The source CRS's EPSG code. */
  epsg: number;
};

/** The parts of a `GeoTIFF` the explainer uses. */
export type GeoTIFFLike = {
  width: number;
  height: number;
  transform: Affine;
  crs: unknown;
  fetchTiles(
    xy: [number, number][],
    options?: { boundless?: boolean; signal?: AbortSignal },
  ): Promise<Tile[]>;
};

/** How far {@link loadImage} has got. */
export type LoadProgress = {
  /** Reads finished so far. */
  done: number;
  /** All the reads: the header, then the pixels. */
  total: number;
};

/**
 * Check that the file is the one the story was written for, and say which
 * field changed if not.
 */
export function checkImage(image: GeoTIFFLike): void {
  const [a, b, c, d, e, f] = image.transform;
  const fields: [string, unknown, unknown][] = [
    ["width", IMAGE.width, image.width],
    ["height", IMAGE.height, image.height],
    ["pixel size", IMAGE.pixelSize, a],
    ["pixel height", -IMAGE.pixelSize, e],
    ["rotation", 0, b + d],
    ["origin x", IMAGE.origin[0], c],
    ["origin y", IMAGE.origin[1], f],
    ["EPSG code", IMAGE.epsg, image.crs],
  ];
  for (const [field, expected, actual] of fields) {
    if (expected !== actual) {
      throw new Error(
        `${FIXTURE_FILE}: expected ${field} ${expected}, got ${actual}. ` +
          "The file has changed; update src/scene/constants.ts.",
      );
    }
  }
}

/** Run a read, naming the file if it fails. */
async function read<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw Object.assign(
      new Error(`Couldn't load ${FIXTURE_FILE}: ${message}`),
      { cause },
    );
  }
}

/**
 * Open the image, check it, and read its pixels. Without `boundless`, the
 * 42 x 42 image is cut from its 64 x 64 block.
 */
export async function loadImage(
  options: {
    open?: (url: string) => Promise<GeoTIFFLike>;
    signal?: AbortSignal;
    /** Called as each read finishes. */
    onProgress?: (progress: LoadProgress) => void;
  } = {},
): Promise<SourceImage> {
  const { signal, onProgress } = options;
  const open =
    options.open ?? ((url: string) => GeoTIFF.fromUrl(url, { signal }));
  const progress: LoadProgress = { done: 0, total: 2 };
  const advance = () => {
    progress.done += 1;
    onProgress?.({ ...progress });
  };

  const geotiff = await read(() => open(FIXTURE_URL));
  advance();
  checkImage(geotiff);
  const [tile] = await read(() =>
    geotiff.fetchTiles([[0, 0]], { boundless: false, signal }),
  );
  advance();
  const array = tile?.array;
  if (
    !array ||
    array.layout !== "pixel-interleaved" ||
    array.width !== IMAGE.width ||
    array.height !== IMAGE.height
  ) {
    throw new Error(`${FIXTURE_FILE}: expected one 42 x 42 band of pixels.`);
  }
  return {
    values: Uint8Array.from(array.data as ArrayLike<number>),
    width: array.width,
    height: array.height,
    transform: geotiff.transform,
    epsg: IMAGE.epsg,
  };
}
