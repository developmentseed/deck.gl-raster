import type { CompositeLayerProps } from "@deck.gl/core";
import type {
  TileLayerProps,
  _TileLoadProps as TileLoadProps,
} from "@deck.gl/geo-layers";
import type { Device } from "@luma.gl/core";
import type { RenderTileResult } from "../raster-layer.js";
import type { TilesetDescriptor } from "../raster-tileset/index.js";

/**
 * Minimum interface returned by `getTileData`.
 */
export type MinimalDataT = {
  /** Tile height in pixels. */
  height: number;
  /** Tile width in pixels. */
  width: number;
  /**
   * Byte length of the tile data, used by deck.gl's TileLayer for
   * byte-based cache eviction when `maxCacheByteSize` is set. Optional.
   */
  byteLength?: number;
};

/**
 * Options passed to a user-supplied `getTileData` callback.
 */
export type GetTileDataOptions = {
  /** The luma.gl Device. Optional — consumers that don't touch GPU may ignore. */
  device?: Device;
  /**
   * Combined AbortSignal: the layer's `signal` prop composed with the
   * TileLayer's per-tile lifecycle signal. Fires when either aborts.
   */
  signal?: AbortSignal;
};

/**
 * Props for {@link RasterTileLayer}.
 */
export type RasterTileLayerProps<DataT extends MinimalDataT = MinimalDataT> =
  CompositeLayerProps &
    Pick<
      TileLayerProps,
      | "tileSize"
      | "zoomOffset"
      | "maxZoom"
      | "minZoom"
      | "extent"
      | "debounceTime"
      | "maxCacheSize"
      | "maxCacheByteSize"
      | "maxRequests"
      | "refinementStrategy"
    > & {
      /**
       * Tile pyramid + CRS projection descriptor.
       *
       * Subclasses may supply this via state by overriding the protected
       * `_getTilesetDescriptor()` method.
       */
      tilesetDescriptor?: TilesetDescriptor;

      /**
       * Load data for one tile. Runs once per (x, y, z); the resulting `DataT`
       * is cached by the underlying TileLayer.
       *
       * Subclasses may supply this via state by overriding `_getGetTileData()`.
       */
      getTileData?: (
        tile: TileLoadProps,
        options: GetTileDataOptions,
      ) => Promise<DataT>;

      /**
       * Turn cached tile data into a render result (image and/or shader pipeline).
       * Called on every render; does not re-fetch.
       *
       * Subclasses may supply this via state by overriding `_getRenderTile()`.
       */
      renderTile?: (data: DataT) => RenderTileResult;

      /**
       * Maximum reprojection error in pixels for mesh refinement.
       * Lower values create denser meshes.
       * @default 0.125
       */
      maxError?: number;

      /**
       * Show triangulation mesh + tile outlines.
       * @default false
       */
      debug?: boolean;

      /**
       * Opacity of the debug mesh overlay (0–1).
       * @default 0.5
       */
      debugOpacity?: number;

      /**
       * AbortSignal applied to every tile fetch, composed with TileLayer's
       * per-tile signal.
       */
      signal?: AbortSignal;
    };
