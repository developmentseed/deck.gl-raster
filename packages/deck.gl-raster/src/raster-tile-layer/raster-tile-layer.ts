import type { CompositeLayerProps, DefaultProps, Layer } from "@deck.gl/core";
import { CompositeLayer } from "@deck.gl/core";
import type {
  _Tile2DHeader as Tile2DHeader,
  TileLayerProps,
  _TileLoadProps as TileLoadProps,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { triangulateRectangle } from "@developmentseed/raster-reproject";
import type { Device } from "@luma.gl/core";
import { renderDebugTileOutline } from "../layer-utils.js";
import type { RenderTileResult } from "../raster-layer.js";
import { RasterLayer } from "../raster-layer.js";
import type { RasterTilesetDescriptor } from "../raster-tileset/index.js";
import { RasterTileset2D } from "../raster-tileset/index.js";
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
    TileLayerProps,
    | "debounceTime"
    | "extent"
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

const defaultProps: DefaultProps<RasterTileLayerProps> = {
  ...TileLayer.defaultProps,
  maxError: 0.125,
  debug: false,
  debugOpacity: 0.5,
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
      updateTriggers,
      onTileError,
      onTileLoad,
      onTileUnload,
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
      onTileError,
      onTileLoad,
      onTileUnload,
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
    const { debug } = this.props;
    const tile = props.tile as Tile2DHeader<DataT> & RasterTileMetadata;
    const debugLayers = debug
      ? this._renderDebug(tile, props.data ?? null)
      : [];

    if (!props.data) {
      return debugLayers;
    }
    const tileResult = renderTile(props.data);
    if (!tileResult) {
      return debugLayers;
    }

    const isGlobe = this.context.viewport.resolution !== undefined;
    const rasterLayers =
      !isGlobe && tile._antimeridianCut
        ? this._renderAntimeridianTile({
            baseId: props.id,
            tile,
            data: props.data,
            tileResult,
            uCut: tile._antimeridianCut.uCut,
          })
        : this._renderNormalTile({
            baseId: props.id,
            tile,
            data: props.data,
            tileResult,
            descriptor,
            isGlobe,
          });
    return [...rasterLayers, ...debugLayers];
  }

  /**
   * Shared base props for every `RasterLayer` produced from a tile — the
   * geometry + render-pipeline pieces that don't depend on globe-vs-mercator
   * or whether the tile crosses the antimeridian.
   */
  private _baseRasterProps(
    data: NonNullable<DataT>,
    tileResult: RenderTileResult,
  ) {
    const { maxError, debug, debugOpacity } = this.props;
    const { image, renderPipeline } = tileResult;
    return {
      width: data.width,
      height: data.height,
      // Passing `image: undefined` explicitly would trip isAsyncPropLoading
      // and cause a transient black flash (see issue #376).
      ...(image !== undefined && { image }),
      renderPipeline,
      maxError,
      debug,
      debugOpacity,
    };
  }

  /**
   * Build the one `RasterLayer` for a tile that renders as a single mesh —
   * either the globe path (lng/lat coordinate system, descriptor-level
   * projection) or the Web Mercator non-crossing path (cartesian common
   * space, per-tile projection with the optional ±85.051° clamp seed).
   */
  private _renderNormalTile(opts: {
    baseId: string;
    tile: Tile2DHeader<DataT> & RasterTileMetadata;
    data: NonNullable<DataT>;
    tileResult: RenderTileResult;
    descriptor: RasterTilesetDescriptor;
    isGlobe: boolean;
  }): Layer[] {
    const { baseId, tile, data, tileResult, descriptor, isGlobe } = opts;
    const { forwardTransform, inverseTransform } = tile;

    // Web Mercator: render in deck.gl common space using the tile's
    // reference-stable `_projectPosition`/`_unprojectPosition` so the mesh
    // does not regenerate (and the shader does not recompile) every frame.
    // Globe: render in lng/lat using the descriptor's 4326 projection.
    const reprojectionFns: ReprojectionFns = isGlobe
      ? {
          forwardTransform,
          inverseTransform,
          forwardReproject: descriptor.projectTo4326,
          inverseReproject: descriptor.projectFrom4326,
        }
      : {
          forwardTransform,
          inverseTransform,
          forwardReproject: tile._projectPosition,
          inverseReproject: tile._unprojectPosition,
        };

    return [
      new RasterLayer(
        this.getSubLayerProps({
          ...this._baseRasterProps(data, tileResult),
          id: `${baseId}-raster`,
          reprojectionFns,
          coordinateSystem: isGlobe ? "lnglat" : "cartesian",
          // Globe shows the poles; Web Mercator clamps tiles past ±85.051°
          // to the valid latitude band via the seed (undefined when no clamp
          // is needed).
          initialTriangulation: isGlobe
            ? undefined
            : tile._webMercatorInitialTriangulation,
        }),
      ),
    ];
  }

  /**
   * Build the two `RasterLayer`s for a Web-Mercator tile that crosses ±180°:
   * a west piece (UV `[0, uCut]`) and an east piece (UV `[uCut, 1]`). Each
   * piece uses its own `ReprojectionFns` bundle from the tile metadata —
   * the bundle composes a `+k·360°` longitude shift into the geotransform
   * so the piece's native lngs stay inside proj4's valid range, and pairs
   * it with the stock `_projectPosition`/`_unprojectPosition` so the
   * forward/inverse round-trip cleanly. The two pieces thus render in
   * different world copies; deck.gl `repeat: true` + world-copy traversal
   * (#518) bring them together visually. The split itself lives in each
   * piece's `triangulateRectangle` seed.
   */
  private _renderAntimeridianTile(opts: {
    baseId: string;
    tile: Tile2DHeader<DataT> & RasterTileMetadata;
    data: NonNullable<DataT>;
    tileResult: RenderTileResult;
    uCut: number;
  }): Layer[] {
    const { baseId, tile, data, tileResult, uCut: uCutGeographic } = opts;
    // `antimeridianCut` returns the seam location as a fraction of the tile's
    // geographic span (0..1 over the full west→east lng range). The reprojector
    // maps its UV [0, 1] to pixel-INDEX [0, W-1] (delatin.ts:470), so the same
    // fraction has to be scaled by W/(W-1) to land on the seam pixel. W here
    // is the actual image data width (`data.width`), not `tile.tileWidth` —
    // for a COG, `tile.tileWidth` is the block size (e.g. 64 for
    // antimeridian.tif), but the data passed to the reprojector is the
    // (smaller) image size (42), and the reprojector keys off that.
    const uCut = (uCutGeographic * data.width) / (data.width - 1);
    const baseProps = {
      ...this._baseRasterProps(data, tileResult),
      coordinateSystem: "cartesian" as const,
    };
    return [
      new RasterLayer(
        this.getSubLayerProps({
          ...baseProps,
          id: `${baseId}-raster-west`,
          reprojectionFns: tile._westReprojection!,
          initialTriangulation: triangulateRectangle(0, 0, uCut, 1),
        }),
      ),
      new RasterLayer(
        this.getSubLayerProps({
          ...baseProps,
          id: `${baseId}-raster-east`,
          reprojectionFns: tile._eastReprojection!,
          initialTriangulation: triangulateRectangle(uCut, 0, 1, 1),
        }),
      ),
    ];
  }
}
