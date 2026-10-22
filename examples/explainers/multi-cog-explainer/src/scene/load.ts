import type { RasterArray, Tile } from "@developmentseed/geotiff";
import { assembleTiles, GeoTIFF } from "@developmentseed/geotiff";
import type { BandId } from "./constants.js";
import { BAND_IDS, BANDS, bandUrl, SCENE_ORIGIN } from "./constants.js";
import type { ImageGeometry, StoryTile } from "./geometry.js";
import { imagesByLevel, levelFor, resolveStoryTile } from "./geometry.js";

/** An image (a GeoTIFF or one of its overviews) that can fetch tiles. */
export type ImageLike = ImageGeometry & {
  fetchTiles(
    xy: [number, number][],
    options?: { boundless?: boolean; signal?: AbortSignal },
  ): Promise<Tile[]>;
};

/** The parts of a `GeoTIFF` the explainer uses. */
export type GeoTIFFLike = ImageLike & { overviews: ImageLike[] };

/** Everything the story draws from, fetched once at startup. */
export type SceneData = {
  /** How each band covers the story tile. */
  tile: StoryTile;
  /** The covering tiles of each band, as fetched (step 4). */
  fetched: Record<BandId, Tile[]>;
  /** Each band's covering tiles stitched into one texture (step 5 on). */
  stitched: Record<BandId, RasterArray>;
  /** Each band's coarsest overview, stitched whole (the scene panel). */
  overview: Record<BandId, RasterArray>;
};

/**
 * Check that a band's full-resolution image is the one the story was written
 * for, and say which field changed if not.
 */
export function checkBand(band: BandId, image: ImageGeometry): void {
  const spec = BANDS[band];
  checkFields(spec.file, [
    ["width", spec.size, image.width],
    ["height", spec.size, image.height],
    ["tileWidth", spec.block, image.tileWidth],
    ["tileHeight", spec.block, image.tileHeight],
    ["pixel size", spec.pixelSize, image.transform[0]],
    ["origin x", SCENE_ORIGIN[0], image.transform[2]],
    ["origin y", SCENE_ORIGIN[1], image.transform[5]],
  ]);
}

/** Check a band's coarsest overview the same way. */
function checkOverview(band: BandId, overview: ImageGeometry): void {
  const spec = BANDS[band];
  checkFields(`${spec.file} overview`, [
    ["width", spec.overviewSize, overview.width],
    ["tileWidth", spec.overviewBlock, overview.tileWidth],
  ]);
}

function checkFields(
  name: string,
  fields: [field: string, expected: number, actual: number][],
): void {
  for (const [field, expected, actual] of fields) {
    if (Math.abs(expected - actual) > 1e-6) {
      throw new Error(
        `${name}: expected ${field} ${expected}, got ${actual}. ` +
          "The source files have changed; update src/scene/constants.ts.",
      );
    }
  }
}

/** Run `work` for one band, naming the band if it fails. */
async function forBand<T>(band: BandId, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw Object.assign(
      new Error(`Couldn't load ${BANDS[band].file}: ${message}`),
      { cause },
    );
  }
}

/** Fetch every tile of an image and stitch them into one array. */
async function fetchWhole(
  image: ImageLike,
  signal: AbortSignal | undefined,
): Promise<RasterArray> {
  const cols = Math.ceil(image.width / image.tileWidth);
  const rows = Math.ceil(image.height / image.tileHeight);
  const xy: [number, number][] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      xy.push([x, y]);
    }
  }
  const tiles = await image.fetchTiles(xy, { boundless: false, signal });
  return assembleTiles(tiles, {
    width: image.width,
    height: image.height,
    tileWidth: image.tileWidth,
    tileHeight: image.tileHeight,
    minCol: 0,
    minRow: 0,
  });
}

/** How far {@link loadScene} has got. */
export type LoadProgress = {
  /** Reads finished so far. */
  done: number;
  /** All the reads: each band's header, covering tiles and overview. */
  total: number;
};

/**
 * Open the three bands' COGs, check them, resolve the story tile with the
 * real functions, and fetch and stitch everything the story draws.
 */
export async function loadScene(
  options: {
    open?: (url: string) => Promise<GeoTIFFLike>;
    signal?: AbortSignal;
    /** Called as each read finishes. */
    onProgress?: (progress: LoadProgress) => void;
  } = {},
): Promise<SceneData> {
  const { signal, onProgress } = options;
  const open =
    options.open ?? ((url: string) => GeoTIFF.fromUrl(url, { signal }));
  const progress: LoadProgress = { done: 0, total: 3 * BAND_IDS.length };
  const advance = () => {
    progress.done += 1;
    onProgress?.({ ...progress });
  };

  const opened = await Promise.all(
    BAND_IDS.map((band) =>
      forBand(band, async () => {
        const image = await open(bandUrl(band));
        advance();
        return image;
      }),
    ),
  );
  const images = {} as Record<BandId, GeoTIFFLike>;
  BAND_IDS.forEach((band, i) => {
    const image = opened[i]!;
    checkBand(band, image);
    const coarsest = image.overviews[image.overviews.length - 1];
    if (!coarsest) {
      throw new Error(`${BANDS[band].file}: expected overviews, got none.`);
    }
    checkOverview(band, coarsest);
    images[band] = image;
  });

  const levels = (band: BandId) =>
    imagesByLevel(images[band]).map((image) => levelFor(band, image));
  const tile = resolveStoryTile({
    b04: levels("b04"),
    b11: levels("b11"),
    b01: levels("b01"),
  });

  const fetched = {} as Record<BandId, Tile[]>;
  const stitched = {} as Record<BandId, RasterArray>;
  const overview = {} as Record<BandId, RasterArray>;
  await Promise.all(
    BAND_IDS.map((band) =>
      forBand(band, async () => {
        const image = images[band];
        const cover = tile.bands[band];
        // The image at the level the tiles were resolved on, as the layer's
        // selectImage picks it.
        const level = imagesByLevel(image)[cover.z]!;
        const tiles = await level.fetchTiles(
          cover.tiles.map(({ x, y }): [number, number] => [x, y]),
          { boundless: false, signal },
        );
        advance();
        fetched[band] = tiles;
        stitched[band] = assembleTiles(tiles, {
          width: cover.stitchedWidth,
          height: cover.stitchedHeight,
          tileWidth: level.tileWidth,
          tileHeight: level.tileHeight,
          minCol: cover.minCol,
          minRow: cover.minRow,
        });
        overview[band] = await fetchWhole(
          image.overviews[image.overviews.length - 1]!,
          signal,
        );
        advance();
      }),
    ),
  );

  return { tile, fetched, stitched, overview };
}
