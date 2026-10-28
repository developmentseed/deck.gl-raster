import type { _TileLoadProps as TileLoadProps } from "@deck.gl/geo-layers";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-raster";
import type { PMTilesSource } from "../pmtiles/pmtiles-source.js";
import { cellSize, tileMercatorYRange } from "../web-mercator.js";
import type { BorderCache } from "./border-cache.js";
import { decodeTerrariumTile } from "./decode-tile.js";
import type { TileBorder } from "./halo.js";
import {
  buildHaloArray,
  buildRing,
  extractBorder,
  ringWrites,
} from "./halo.js";
import type { TileIndex } from "./neighbors.js";
import { CENTER_INDEX, neighborIndices } from "./neighbors.js";
import type { TerrainTileData } from "./types.js";

/**
 * Fetch one tile from a PMTiles archive and decode its Terrarium elevations.
 * Resolves `null` when the archive has no such tile.
 */
export async function loadTerrariumElevation(options: {
  source: PMTilesSource;
  tile: TileIndex;
  signal: AbortSignal;
}): Promise<Float32Array | null> {
  const { source, tile, signal } = options;
  const response = await source.archive.getZxy(tile.z, tile.x, tile.y, signal);
  if (!response) {
    return null;
  }
  signal.throwIfAborted();
  return decodeTerrariumTile(response.data, {
    tileSize: source.tileSize,
    mimeType: source.mimeType,
  });
}

/** Options for {@link makeGetTileData}. */
export interface MakeGetTileDataOptions {
  /** Shared across every tile the layer renders; see {@link BorderCache}. */
  cache: BorderCache;
  /** Width and height of a tile, in texels. */
  tileSize: number;
  /**
   * Called after a tile's halo was rewritten in place with neighbors that
   * arrived late. The caller must make deck.gl redraw: a texture changed
   * without any layer prop changing.
   */
  onTileRefined: () => void;
}

/**
 * Build a `getTileData` callback that uploads each tile with a one-texel halo
 * of its neighbors' elevations, in two phases, so a tile never waits on its
 * neighbors to appear:
 *
 * 1. **Display.** As soon as the tile itself decodes, its halo is built from
 *    whichever neighbors' borders have already arrived, with the tile's own
 *    edge replicated for the rest, and uploaded. The tile draws at once.
 * 2. **Refine.** When the outstanding neighbors settle, only the ring is
 *    rewritten in the *same* texture, and `onTileRefined` asks for a redraw.
 *
 * The tile and its neighbors are requested in one synchronous pass, so their
 * reads land in one task and the range reader merges them.
 */
export function makeGetTileData(
  options: MakeGetTileDataOptions,
): (
  tile: TileLoadProps,
  options: GetTileDataOptions,
) => Promise<TerrainTileData | null> {
  const { cache, tileSize, onTileRefined } = options;

  return async function getTileData(tile, tileOptions) {
    const { device, signal } = tileOptions;
    const { x, y, z } = tile.index;
    const block = neighborIndices({ z, x, y });

    const elevationRequest = cache.getElevation({ z, x, y }, signal);
    const neighborRequests = block.map((neighbor, i) =>
      neighbor === null || i === CENTER_INDEX
        ? null
        : cache.getBorder(neighbor, signal),
    );
    // A neighbor that fails only leaves its side replicated.
    for (const request of neighborRequests) {
      request?.catch(() => {});
    }

    const elevation = await elevationRequest;
    if (elevation === null) {
      return null;
    }

    const center = extractBorder(elevation, tileSize);
    const knownBorders = (): Array<TileBorder | null | undefined> =>
      block.map((neighbor, i) =>
        neighbor === null || i === CENTER_INDEX
          ? null
          : cache.peekBorder(neighbor),
      );
    const borders = knownBorders();
    const halo = buildHaloArray({
      elevation,
      ring: buildRing({ center, neighbors: borders, tileSize }),
      tileSize,
    });
    const texture = device.createTexture({
      format: "r32float",
      width: tileSize + 2,
      height: tileSize + 2,
      mipLevels: 1,
      data: halo,
      sampler: {
        // The kernel reads exact texels with `texelFetch`, so no filtering is
        // wanted (and `r32float` isn't filterable everywhere).
        minFilter: "nearest",
        magFilter: "nearest",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      },
    });

    const pending = neighborRequests.filter(
      (request, i): request is Promise<TileBorder | null> =>
        request !== null && borders[i] === undefined,
    );
    if (pending.length > 0) {
      // Deliberately not awaited. The closure keeps only the tile's border.
      void Promise.allSettled(pending).then(() => {
        if (signal?.aborted || texture.destroyed) {
          return;
        }
        const ring = buildRing({
          center,
          neighbors: knownBorders(),
          tileSize,
        });
        for (const write of ringWrites(ring, tileSize)) {
          const { data, ...rect } = write;
          texture.writeData(data, rect);
        }
        onTileRefined();
      });
    }

    return {
      texture,
      width: tileSize,
      height: tileSize,
      byteLength: halo.byteLength,
      cellSize: cellSize(z, tileSize),
      mercatorYRange: tileMercatorYRange(z, y),
    };
  };
}
