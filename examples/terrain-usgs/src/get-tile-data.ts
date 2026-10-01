import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import type { MinimalTileData } from "@developmentseed/deck.gl-raster";
import type { GeoTIFF, Overview, Tile } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";
import { buildHaloArray, CENTER_INDEX } from "./halo.js";
import type { TileCache } from "./tile-cache.js";

/**
 * Fallback nodata sentinel for files with no `GDAL_NODATA` tag. `-FLT_MAX` is
 * itself one of the values USGS uses, and no real elevation comes near it.
 */
const DEFAULT_NODATA = -3.4028235e38;

/** Per-tile data for the terrain example. */
export type TerrainTileData = MinimalTileData & {
  /**
   * `r32float` elevation texture of size `(width + 2) × (height + 2)` — the
   * tile ringed by one texel of its neighbors, so the 3×3 shading kernel has
   * real data at the tile border. See {@link buildHaloArray}.
   *
   * The ring may start out replicated from the tile's own edge and be
   * rewritten in place once the neighbors arrive; see {@link makeGetTileData}.
   */
  texture: Texture;
  /**
   * Ground sample distance in CRS units (meters, for the UTM-projected USGS
   * products). Varies per overview level, so slope must be scaled per tile.
   */
  cellSize: number;
  /** The nodata sentinel for this file. */
  nodata: number;
};

/** The nine `(dx, dy)` offsets of a tile and its neighbors, row-major. */
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * Extract band 0 of a tile as a `Float32Array`.
 *
 * These products are single-band, so the two decoder layouts carry the same
 * flat `width * height` samples and differ only in where they are held.
 */
function elevationBand(tile: Tile): Float32Array {
  const { array } = tile;
  if (array.count !== 1) {
    throw new Error(
      `Expected single-band elevation data, got ${array.count} bands`,
    );
  }

  const samples =
    array.layout === "band-separate" ? array.bands[0] : array.data;
  if (!(samples instanceof Float32Array)) {
    throw new Error(
      `Expected float32 elevation samples, got ${samples?.constructor.name}`,
    );
  }
  return samples;
}

/** Options for {@link makeGetTileData}. */
export interface MakeGetTileDataOptions {
  /**
   * Shared decoded-tile cache. The eight neighbors of every tile are
   * themselves rendered tiles, so caching keeps the cost near one decode per
   * tile rather than nine.
   */
  cache: TileCache;
  /**
   * Called after a tile's halo has been upgraded in place with newly arrived
   * neighbor data. The caller must trigger a deck.gl redraw, since the texture
   * changed without any layer prop changing.
   */
  onTileRefined: () => void;
}

/**
 * Build a `getTileData` callback that assembles each tile with a one-texel
 * halo of its neighbors' elevation.
 *
 * Loading is two-phase, so a tile never waits on its neighbors to appear:
 *
 * 1. **Display.** As soon as the tile itself decodes, a halo is built from
 *    whatever neighbors have already arrived, with the tile's own edge
 *    replicated everywhere else, and uploaded. The tile draws immediately —
 *    briefly with a faint seam wherever a neighbor was still in flight.
 * 2. **Refine.** When the outstanding neighbors resolve, the halo is rebuilt
 *    and written into the *same* texture, and `onTileRefined` asks for a
 *    redraw. The seams disappear without the tile ever having been blank.
 *
 * Awaiting all nine fetches up front would instead make every tile's latency
 * the slowest of nine requests rather than one — correct, but needlessly slow
 * to first paint.
 */
export function makeGetTileData(
  options: MakeGetTileDataOptions,
): (
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
) => Promise<TerrainTileData> {
  const { cache, onTileRefined } = options;

  return async function getTileData(image, tileOptions) {
    const { x, y, device, pool, signal } = tileOptions;
    const tileWidth = image.tileWidth;
    const tileHeight = image.tileHeight;
    const { x: tileCountX, y: tileCountY } = image.tileCount;

    // Start every in-bounds neighbor fetching, but await only the center.
    const requests = NEIGHBOR_OFFSETS.map(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= tileCountX || ny >= tileCountY) {
        return null;
      }
      return { nx, ny, promise: cache.fetch(image, nx, ny, { pool }) };
    });

    const centerRequest = requests[CENTER_INDEX];
    if (!centerRequest) {
      throw new Error(`Tile (${x}, ${y}) is outside the image's tile grid`);
    }
    await centerRequest.promise;

    /**
     * Assemble the halo from whatever is in the cache right now. Neighbors
     * still in flight come back `null`, and {@link buildHaloArray} replicates
     * the center tile's edge in their place.
     */
    const assemble = (): { halo: Float32Array; complete: boolean } => {
      let complete = true;
      const tiles = requests.map((request) => {
        if (!request) {
          // Genuinely outside the image — never going to arrive, and not a
          // reason to keep waiting.
          return null;
        }
        const tile = cache.peek(image, request.nx, request.ny);
        if (!tile) {
          complete = false;
          return null;
        }
        return elevationBand(tile);
      });
      return {
        halo: buildHaloArray({ tiles, tileWidth, tileHeight }),
        complete,
      };
    };

    const { halo, complete } = assemble();

    const texture = device.createTexture({
      format: "r32float",
      width: tileWidth + 2,
      height: tileHeight + 2,
      mipLevels: 1,
      data: halo,
      sampler: {
        // The shading kernel reads exact texels with `texelFetch`, so no
        // filtering is wanted (and `r32float` is not filterable everywhere).
        minFilter: "nearest",
        magFilter: "nearest",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      },
    });

    if (!complete) {
      // Phase 2, deliberately not awaited: refine the ring once the stragglers
      // land. `allSettled` because a neighbor that fails should still let the
      // others through.
      const pending = requests
        .filter((request) => request !== null)
        .map((request) => request.promise);

      void Promise.allSettled(pending).then(() => {
        // The tile may have been unloaded while its neighbors were in flight,
        // in which case its texture is already destroyed.
        if (signal?.aborted || texture.destroyed) {
          return;
        }
        texture.writeData(assemble().halo);
        onTileRefined();
      });
    }

    return {
      texture,
      // The *logical* tile size, deliberately not the texture's. RasterLayer
      // triangulates from these dimensions, so the mesh stays on the unpadded
      // tile grid and only the shader accounts for the halo inset.
      width: tileWidth,
      height: tileHeight,
      byteLength: halo.byteLength,
      cellSize: Math.abs(image.transform[0]),
      nodata: image.nodata ?? DEFAULT_NODATA,
    };
  };
}
