import type { MinimalTileData } from "@developmentseed/deck.gl-raster";
import type { Texture } from "@luma.gl/core";

/** One loaded terrain tile, as `getTileData` returns it. */
export type TerrainTileData = NonNullable<MinimalTileData> & {
  /**
   * `r32float` elevation texture of size `(width + 2) x (height + 2)`: the
   * tile ringed by one texel of its neighbors. A side whose neighbor hasn't
   * loaded replicates the tile's own edge, and is rewritten when it loads.
   */
  texture: Texture;
  /**
   * The *logical* tile size, not the texture's: `RasterTileLayer` meshes from
   * these, so the mesh stays on the unpadded grid and only the shader
   * accounts for the halo.
   */
  width: number;
  height: number;
  /** Bytes held by the texture, for deck.gl's cache accounting. */
  byteLength: number;
  /** Width of a texel on the Web Mercator plane at the tile's zoom, in meters. */
  cellSize: number;
  /** Web Mercator y of the tile's north and south edges, in meters. */
  mercatorYRange: [north: number, south: number];
  /**
   * Stop rewriting this tile's halo as its neighbors load. Call it when the
   * tile is unloaded, so the shared borders let go of its texture.
   */
  release: () => void;
};
