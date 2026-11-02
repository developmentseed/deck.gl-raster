import type { _TileLoadProps as TileLoadProps } from "@deck.gl/geo-layers";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-raster";
import type { PMTilesSource } from "../pmtiles/pmtiles-source.js";
import { cellSize, tileMercatorYRange } from "../web-mercator.js";
import { decodeTerrariumTile } from "./decode-tile.js";
import {
  buildHaloArray,
  buildRing,
  extractBorder,
  ringWrites,
} from "./halo.js";
import type { TileIndex } from "./neighbors.js";
import { CENTER_INDEX, neighborIndices } from "./neighbors.js";
import type { TileBorders } from "./tile-borders.js";
import type { TerrainTileData } from "./types.js";

/**
 * Fetch one tile from a PMTiles archive and decode its Terrarium elevations.
 * Resolves `null` when the archive has no such tile.
 */
export async function loadTerrariumElevation(options: {
  source: PMTilesSource;
  tile: TileIndex;
  signal?: AbortSignal;
}): Promise<Float32Array | null> {
  const { source, tile, signal } = options;
  const response = await source.archive.getZxy(tile.z, tile.x, tile.y, signal);
  if (!response) {
    return null;
  }
  signal?.throwIfAborted();
  return decodeTerrariumTile(response.data, {
    tileSize: source.tileSize,
    mimeType: source.mimeType,
  });
}

/** Options for {@link makeGetTileData}. */
export interface MakeGetTileDataOptions {
  /**
   * Fetch and decode one tile's row-major elevations. Resolves `null` when
   * there's no such tile.
   */
  load: (tile: TileIndex, signal?: AbortSignal) => Promise<Float32Array | null>;
  /** Shared across every tile the layer renders; see {@link TileBorders}. */
  borders: TileBorders;
  /** Width and height of a tile, in texels. */
  tileSize: number;
  /**
   * Called after a drawn tile's halo was rewritten in place for a neighbor
   * that loaded later. The caller must make deck.gl redraw: a texture changed
   * without any layer prop changing.
   */
  onTileRefined: () => void;
}

/**
 * Build a `getTileData` callback that uploads each tile with a one-texel halo
 * of its neighbors' elevations, filled only from neighbors that have loaded
 * anyway, because they're in view. Nothing is fetched just for a halo.
 *
 * A tile draws as soon as it decodes. Each side whose neighbor hasn't loaded
 * replicates the tile's own edge; such sides face the edge of the view. When
 * the neighbor loads later, only the ring is rewritten in the *same* texture,
 * and `onTileRefined` asks for a redraw.
 *
 * Call the returned data's `release` when deck.gl unloads the tile.
 */
export function makeGetTileData(
  options: MakeGetTileDataOptions,
): (
  tile: TileLoadProps,
  options: GetTileDataOptions,
) => Promise<TerrainTileData | null> {
  const { load, borders, tileSize, onTileRefined } = options;

  return async function getTileData(tile, tileOptions) {
    const { device, signal } = tileOptions;
    const { x, y, z } = tile.index;
    const elevation = await load({ z, x, y }, signal);
    if (elevation === null) {
      return null;
    }

    // Added before the ring is built, so a z0 tile, its own east and west
    // neighbor, finds itself.
    const center = extractBorder(elevation, tileSize);
    if (borders.add({ z, x, y }, center) > 0) {
      onTileRefined();
    }
    const block = neighborIndices({ z, x, y });
    const buildKnownRing = () =>
      buildRing({
        center,
        neighbors: block.map((neighbor, i) =>
          neighbor === null || i === CENTER_INDEX
            ? null
            : borders.get(neighbor),
        ),
        tileSize,
      });

    const haloArray = buildHaloArray({
      elevation,
      ring: buildKnownRing(),
      tileSize,
    });
    // Not `data: haloArray`: luma.gl keeps a texture's props, which would hold
    // this 1 MiB array for as long as the tile is cached.
    const texture = device.createTexture({
      format: "r32float",
      width: tileSize + 2,
      height: tileSize + 2,
      mipLevels: 1,
      sampler: {
        // The kernel reads exact texels with `texelFetch`, so no filtering is
        // wanted (and `r32float` isn't filterable everywhere).
        minFilter: "nearest",
        magFilter: "nearest",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      },
    });
    texture.writeData(haloArray);

    // The closure keeps only the tile's border, not its elevations.
    const release = borders.watch({ z, x, y }, () => {
      if (texture.destroyed) {
        return;
      }
      for (const write of ringWrites(buildKnownRing(), tileSize)) {
        const { data, ...rect } = write;
        texture.writeData(data, rect);
      }
    });

    return {
      texture,
      width: tileSize,
      height: tileSize,
      byteLength: haloArray.byteLength,
      cellSize: cellSize(z, tileSize),
      mercatorYRange: tileMercatorYRange(z, y),
      release,
    };
  };
}
