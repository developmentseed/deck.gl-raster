import type {
  CompositeLayerProps,
  CoordinateSystem,
  DefaultProps,
  Layer,
  LayerContext,
} from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import type {
  _Tile2DHeader as Tile2DHeader,
  TileLayerProps,
  _TileLoadProps as TileLoadProps,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { Device } from "@luma.gl/core";
import { renderDebugTileOutline } from "../layer-utils.js";
import type { RenderTileResult } from "../raster-layer.js";
import { RasterLayer } from "../raster-layer.js";
import type { RasterTilesetDescriptor } from "../raster-tileset/index.js";
import { RasterTileset2D } from "../raster-tileset/index.js";
import { TILE_SIZE } from "../raster-tileset/raster-tile-traversal.js";
import type { RasterTileMetadata } from "../raster-tileset/raster-tileset-2d.js";

/**
 * Minimum interface returned by `getTileData`.
 *
 * `null` is permitted to describe failed tile loads that do not produce any
 * data, which then do not render any layer.
 */
export type MinimalTileData = null | {
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
  /**
   * The luma.gl Device. Always populated by the base layer from
   * `this.context.device`.
   */
  device: Device;
  /**
   * Combined AbortSignal: the layer's `signal` prop composed with the
   * TileLayer's per-tile lifecycle signal. Fires when either aborts.
   */
  signal?: AbortSignal;
};

/**
 * Props for {@link RasterTileLayer}.
 */
export type RasterTileLayerProps<
  DataT extends MinimalTileData = MinimalTileData,
> = CompositeLayerProps &
  Pick<
    TileLayerProps<DataT>,
    | "debounceTime"
    | "maxCacheByteSize"
    | "maxCacheSize"
    | "maxRequests"
    | "maxZoom"
    | "minZoom"
    | "onTileError"
    | "onTileLoad"
    | "onTileUnload"
    | "onViewportLoad"
    | "refinementStrategy"
    | "tileSize"
    | "zoomOffset"
  > & {
    /**
     * Tile pyramid + CRS projection descriptor.
     *
     * Subclasses may supply this via state by overriding the protected
     * `_tilesetDescriptor()` method.
     */
    tilesetDescriptor?: RasterTilesetDescriptor;

    /**
     * Only load tiles that overlap this bounding box, given as
     * `[minLng, minLat, maxLng, maxLat]` in WGS84 degrees.
     *
     * Tiles are always limited to the tileset descriptor's bounds; this narrows
     * them further, e.g. to load only part of a global TileMatrixSet such as
     * WebMercatorQuad.
     */
    extent?: number[] | null;

    /**
     * Load data for one tile. Runs once per (x, y, z); the resulting `DataT`
     * is cached by the underlying TileLayer.
     *
     * Subclasses may supply this via state by overriding
     * `_getTileDataCallback()`.
     */
    getTileData?: (
      tile: TileLoadProps,
      options: GetTileDataOptions,
    ) => Promise<DataT>;

    /**
     * Turn cached tile data into a render result (image and/or shader
     * pipeline). Called on every render; does not re-fetch.
     *
     * To invalidate the inner TileLayer's rendered sub-layers when a
     * dependency changes (e.g. a colormap choice), pass
     * `updateTriggers: { renderTile: [dep1, dep2] }` on the layer props.
     *
     * Subclasses may supply this via state by overriding `_renderTileCallback()`.
     */
    renderTile?: (data: DataT) => RenderTileResult | null;

    /**
     * Maximum reprojection error for mesh refinement: how far a tile's mesh
     * may draw a point from where it belongs on the map, in output pixels
     * (one input pixel's size on the map, normally at the center of the
     * meshed area).
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

    /**
     * Lowest and highest elevation, in meters, of the surface the raster is
     * drawn on, such as the terrain under a COG draped with deck.gl's
     * `TerrainExtension`.
     *
     * Tiles are selected for the volume between these heights instead of for
     * the ground at sea level, so tiles the terrain lifts into view still
     * load. This only changes which tiles load; it doesn't move the raster.
     * Ignored in `GlobeView`.
     *
     * A deck.gl `TerrainLayer`'s tiles report their elevations: in its
     * `onTileLoad`, each tile's mesh has a `header.boundingBox`, which is
     * also how `TerrainLayer` sets its own `zRange`. The `cog-terrain`
     * example widens this range as terrain tiles load.
     *
     * @default null
     */
    zRange?: [number, number] | null;
  };

const defaultProps: DefaultProps<RasterTileLayerProps> = {
  ...TileLayer.defaultProps,
  maxError: 0.125,
  debug: false,
  debugOpacity: 0.5,
  // Compared by value, so an inline array doesn't re-render the layer on
  // every update.
  zRange: { type: "array", value: null, optional: true, compare: true },
};

/**
 * Base-class prop shape that excludes the overridable fields.
 *
 * The three overridable fields (`tilesetDescriptor`, `getTileData`,
 * `renderTile`) are declared by `ExtraProps` instead — either via the generic
 * default (for direct use) or by a subclass that provides its own signatures
 * (e.g. `COGLayer`'s `getTileData(image, options)`).
 */
type RasterTileLayerBaseProps<DataT extends MinimalTileData> = Omit<
  RasterTileLayerProps<DataT>,
  "tilesetDescriptor" | "getTileData" | "renderTile"
>;

/**
 * Default `ExtraProps` for direct use of `RasterTileLayer`: brings the three
 * overridable fields back in with the generic signatures. Subclasses supply
 * their own `ExtraProps` to override these.
 */
type RasterTileLayerDefaultExtraProps<DataT extends MinimalTileData> = Pick<
  RasterTileLayerProps<DataT>,
  "tilesetDescriptor" | "getTileData" | "renderTile"
>;

/**
 * Base layer that renders a tiled raster source driven by a generic
 * {@link RasterTilesetDescriptor}.
 *
 * Usable directly (provide `tilesetDescriptor`, `getTileData`, and `renderTile`
 * as props) or as a base class (override the protected `_tilesetDescriptor`,
 * `_getTileDataCallback`, `_renderTileCallback` accessors to source them from
 * state).
 *
 * The generic `ExtraProps` parameter lets a subclass redeclare any of the
 * overridable fields with a domain-specific signature (e.g. `COGLayer`'s
 * `getTileData(image, options)`).
 */
export class RasterTileLayer<
  DataT extends MinimalTileData = MinimalTileData,
  ExtraProps extends object = RasterTileLayerDefaultExtraProps<DataT>,
> extends CompositeLayer<RasterTileLayerBaseProps<DataT> & ExtraProps> {
  static override layerName = "RasterTileLayer";
  static override defaultProps = defaultProps;

  declare state: {
    // Subclasses declare their own fields
    [key: string]: unknown;
    /** Aborts the metadata load in flight when a newer one starts or the
     *  layer is removed. */
    metadataAbortController?: AbortController;
    /** True while the latest metadata load is in flight. */
    loadingMetadata?: boolean;
  };

  override finalizeState(context: LayerContext): void {
    this.state.metadataAbortController?.abort();
    super.finalizeState(context);
  }

  /**
   * Start a {@link RasterTileLayer._loadMetadata}, replacing any load still in
   * flight.
   *
   * Subclasses call this from `updateState` when their input changes. It
   * aborts the previous load's signal, and makes
   * {@link RasterTileLayer._isLoadingMetadata} return `true` until the latest
   * load settles. Only the latest load's errors reach `onError`. Removing the
   * layer aborts the load in flight.
   *
   * @param options.errorMsg Prefix for errors raised from this load, such as
   *   `"loading GeoTIFF"`.
   */
  protected _reloadMetadata({ errorMsg }: { errorMsg: string }): void {
    this.state.metadataAbortController?.abort();
    const metadataAbortController = new AbortController();
    const { signal } = metadataAbortController;
    this.setState({ metadataAbortController, loadingMetadata: true });

    this._loadMetadata(signal)
      .catch((error: Error) => {
        // A replaced load's errors, including its AbortError, are moot
        if (!signal.aborted) {
          this.raiseError(error, errorMsg);
        }
      })
      .finally(() => {
        // A replaced load no longer owns `loadingMetadata`
        if (!signal.aborted) {
          this.setState({ loadingMetadata: false });
        }
      });
  }

  /**
   * Load this layer's metadata and store it in state.
   *
   * Called by {@link RasterTileLayer._reloadMetadata}. deck.gl hands every new
   * instance of a layer the old instance's `state`, so a load started by an
   * earlier render can finish after a newer one has begun. To drop such a
   * load, pass `signal` to the requests it makes, and call
   * `signal.throwIfAborted()` after the last `await`, before `setState` or
   * callbacks.
   *
   * The base layer takes its descriptor from props, so it loads nothing.
   */
  protected async _loadMetadata(_signal: AbortSignal): Promise<void> {}

  /**
   * The currently effective {@link RasterTilesetDescriptor}.
   *
   * Subclasses override this to return a descriptor built from their own
   * async-parsed state. Returns `undefined` while the source is still
   * loading; `renderLayers()` returns `null` in that case.
   *
   * The inline cast to `RasterTileLayerProps<DataT>` is required because
   * `tilesetDescriptor` is declared on `ExtraProps`, not on the base's
   * `RasterTileLayerBaseProps`. For direct use the default `ExtraProps`
   * brings it in; for subclass use this method is overridden and the cast
   * is never reached.
   */
  protected _tilesetDescriptor(): RasterTilesetDescriptor | undefined {
    return (this.props as unknown as RasterTileLayerProps<DataT>)
      .tilesetDescriptor;
  }

  /**
   * Whether the layer is still fetching the metadata.
   *
   * `true` while a load started with {@link RasterTileLayer._reloadMetadata}
   * is in flight. Subclasses that load metadata some other way can override
   * this.
   *
   * The base layer takes its descriptor from props, so on its own it never
   * waits on metadata.
   */
  protected _isLoadingMetadata(): boolean {
    // `state` is unset until deck.gl initializes the layer
    return this.state?.loadingMetadata === true;
  }

  /**
   * Whether the layer has finished loading its data.
   *
   * We override this to return `false` while metadata is still loading.
   */
  override get isLoaded(): boolean {
    return !this._isLoadingMetadata() && super.isLoaded;
  }

  /**
   * The currently effective tile-fetch callback.
   *
   * Subclasses override this to adapt their user-facing `getTileData`
   * signature into the base's `(tile, options) => Promise<DataT>` shape.
   * Returns `undefined` when the callback is not yet available.
   */
  protected _getTileDataCallback(): RasterTileLayerProps<DataT>["getTileData"] {
    return (this.props as unknown as RasterTileLayerProps<DataT>).getTileData;
  }

  /**
   * The currently effective per-tile render callback.
   *
   * Subclasses override this to thread their user-facing `renderTile` and
   * any inferred default. Returns `undefined` when no callback is available.
   */
  protected _renderTileCallback(): RasterTileLayerProps<DataT>["renderTile"] {
    return (this.props as unknown as RasterTileLayerProps<DataT>).renderTile;
  }

  /**
   * The currently effective tile-unload callback.
   *
   * Subclasses override this to destroy GPU textures their default pipeline
   * created before delegating to the user's `onTileUnload`. The base layer owns
   * no textures, so it returns the user's callback unchanged.
   */
  protected _onTileUnloadCallback(): RasterTileLayerProps<DataT>["onTileUnload"] {
    return this.props.onTileUnload;
  }

  /**
   * Hook for rendering per-tile debug overlay sub-layers.
   *
   * Called once per tile from `_renderSubLayers` only when `props.debug` is
   * `true`. The hook fires both before data has arrived (`data` is `null`) and
   * after (`data` is the fetched `DataT`), so the default outline can render
   * during loading.
   *
   * Default behavior renders the primary tile boundary via
   * {@link renderDebugTileOutline} using the active descriptor. Subclasses can
   * override to replace, extend (via `super._renderDebug(...)`), or suppress
   * the default — for example, a multi-source layer can replace the default
   * with per-band tile outlines and tiered metadata labels once `data` is
   * available.
   */
  protected _renderDebug(
    tile: Tile2DHeader<DataT>,
    _data: DataT | null,
  ): Layer[] {
    const descriptor = this._tilesetDescriptor();
    if (!descriptor) {
      return [];
    }
    // Tiles built by RasterTileset2D are augmented with RasterTileMetadata
    // (projectedBbox/Corners, tileWidth/Height) at construction time. The cast
    // makes that runtime augmentation visible to the typed helper.
    return renderDebugTileOutline(
      `${this.id}-${tile.id}-bounds`,
      tile as Tile2DHeader<DataT> & RasterTileMetadata,
      descriptor.projectTo4326,
    );
  }

  override renderLayers(): Layer | null {
    const descriptor = this._tilesetDescriptor();
    const getTileData = this._getTileDataCallback();
    const renderTile = this._renderTileCallback();

    if (!descriptor || !getTileData || !renderTile) {
      return null;
    }

    return this._renderTileLayer(descriptor, getTileData, renderTile);
  }

  private _renderTileLayer(
    descriptor: RasterTilesetDescriptor,
    getTileData: NonNullable<RasterTileLayerProps<DataT>["getTileData"]>,
    renderTile: NonNullable<RasterTileLayerProps<DataT>["renderTile"]>,
  ): TileLayer {
    // Capture the device once so the inner `TilesetFactory` can read
    // its current effective device-pixel ratio per `getTileIndices`
    // call. The ratio is sampled lazily so window-drag-between-displays
    // (or runtime changes to `useDevicePixels`) take effect on the next
    // traversal. See dev-docs/lod-and-pixel-matching.md § (A).
    //
    // We compute drawingBuffer/CSS rather than using
    // `cssToDeviceRatio()` (deprecated) or the `devicePixelRatio`
    // property (always reflects the system value, ignoring
    // `Deck.useDevicePixels`). The drawing-buffer ratio is the
    // *effective* DPR Deck is rendering at.
    const device = this.context.device;
    // It's important for `TilesetFactory` to be a new class on every call
    // because deck.gl compares `TilesetClass` by identity: the new class makes
    // the inner `TileLayer` re-render loaded tiles with the current props.
    // See #710.
    class TilesetFactory extends RasterTileset2D {
      constructor(opts: Tileset2DProps) {
        super(opts, descriptor, {
          getPixelRatio: () => {
            const ctx = device.getDefaultCanvasContext();
            const [drawingBufferWidth] = ctx.getDrawingBufferSize();
            const [cssWidth] = ctx.getCSSSize();
            return cssWidth ? drawingBufferWidth / cssWidth : 1;
          },
        });
      }
    }

    const {
      tileSize,
      zoomOffset,
      maxZoom,
      minZoom,
      extent,
      debounceTime,
      maxCacheSize,
      maxCacheByteSize,
      maxRequests,
      refinementStrategy,
      zRange,
      updateTriggers,
      onTileError,
      onTileLoad,
      onViewportLoad,
    } = this.props;

    return new TileLayer<DataT>({
      id: `raster-tile-layer-${this.id}`,
      TilesetClass: TilesetFactory,
      getTileData: (tile) => this._wrapGetTileData(tile, getTileData),
      renderSubLayers: (props) =>
        this._renderSubLayers(
          props as TileLayerProps<DataT> & {
            id: string;
            data?: DataT;
            _offset: number;
            tile: Tile2DHeader<DataT>;
          },
          descriptor,
          renderTile,
        ),
      updateTriggers: {
        renderSubLayers: updateTriggers?.renderTile,
      },
      tileSize,
      zoomOffset,
      maxZoom,
      minZoom,
      extent,
      debounceTime,
      maxCacheSize,
      maxCacheByteSize,
      maxRequests,
      refinementStrategy,
      zRange,
      onTileError,
      onTileLoad,
      onTileUnload: this._onTileUnloadCallback(),
      onViewportLoad,
    });
  }

  private async _wrapGetTileData(
    tile: TileLoadProps,
    getTileData: NonNullable<RasterTileLayerProps<DataT>["getTileData"]>,
  ): Promise<DataT> {
    const { signal: tileSignal } = tile;
    const userSignal = this.props.signal;
    const signal =
      userSignal && tileSignal
        ? AbortSignal.any([userSignal, tileSignal])
        : (userSignal ?? tileSignal);
    const options: GetTileDataOptions = {
      device: this.context.device,
      signal,
    };
    return getTileData(tile, options);
  }

  private _renderSubLayers(
    props: TileLayerProps<DataT> & {
      id: string;
      data?: DataT;
      _offset: number;
      tile: Tile2DHeader<DataT>;
    },
    descriptor: RasterTilesetDescriptor,
    renderTile: NonNullable<RasterTileLayerProps<DataT>["renderTile"]>,
  ): Layer[] {
    const { maxError, debug, debugOpacity } = this.props;
    const tile = props.tile as Tile2DHeader<DataT> & RasterTileMetadata;

    const debugLayers = debug
      ? this._renderDebug(tile, props.data ?? null)
      : [];

    if (!props.data) {
      return debugLayers;
    }

    // Access forwardTransform/inverseTransform from tile metadata so that
    // reference equality holds across renders.
    const { forwardTransform, inverseTransform } = tile;
    const tileResult = renderTile(props.data);
    if (!tileResult) {
      return debugLayers;
    }
    const { image, renderPipeline } = tileResult;
    const { width, height } = props.data;

    const isGlobe = this.context.viewport.resolution !== undefined;
    let reprojectionFns: ReprojectionFns;
    let coordinateSystem: CoordinateSystem;
    // The period of the mesh's x axis, if it wraps around.
    let wrapX: number | undefined;
    if (isGlobe) {
      // Globe view
      reprojectionFns = {
        forwardTransform,
        inverseTransform,
        forwardReproject: descriptor.projectTo4326,
        inverseReproject: descriptor.projectFrom4326,
      };
      coordinateSystem = "lnglat";
    } else {
      // Web Mercator: render the mesh directly in deck.gl common space.
      //
      // The tile's `_projectPosition` maps source CRS → common space, support
      // high precision with fp64 emulation.
      //
      // `_projectPosition`/`_unprojectPosition` must be reference-stable across
      // renders to avoid regenerating the mesh and recompiling the shader every
      // frame.
      const { _projectPosition, _unprojectPosition } = tile;
      reprojectionFns = {
        forwardTransform,
        inverseTransform,
        forwardReproject: _projectPosition,
        inverseReproject: _unprojectPosition,
      };
      coordinateSystem = "cartesian";
      // Common space wraps every world: RasterLayer meshes a tile that
      // crosses the antimeridian in one piece, cut at the world's edge.
      wrapX = TILE_SIZE;
    }

    const rasterLayer = new RasterLayer(
      this.getSubLayerProps({
        id: `${props.id}-raster`,
        width,
        height,
        // Passing `image: undefined` explicitly would trip isAsyncPropLoading
        // and cause a transient black flash (see issue #376).
        ...(image !== undefined && { image }),
        renderPipeline,
        maxError,
        reprojectionFns,
        // Web Mercator: clamp the mesh to the valid latitude band for tiles
        // past ±85.051°. Globe renders the full mesh (it shows the poles).
        initialTriangulation: isGlobe
          ? undefined
          : tile._webMercatorInitialTriangulation,
        _wrapX: wrapX,
        debug,
        debugOpacity,
        coordinateSystem,
      }),
    );
    return [rasterLayer, ...debugLayers];
  }
}
