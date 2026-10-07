import type { Layer, UpdateParameters, Viewport } from "@deck.gl/core";
import type {
  _Tile2DHeader as Tile2DHeader,
  TileLayerProps,
  _TileLoadProps as TileLoadProps,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { PathLayer } from "@deck.gl/layers";
import type { COGLayerProps } from "@developmentseed/deck.gl-geotiff";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import type {
  Bounds,
  GetTileDataOptions,
  MinimalTileData,
  RasterTileLayerProps,
  RasterTilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import { RasterLayer } from "@developmentseed/deck.gl-raster";
import type { InitialTriangulation } from "@developmentseed/raster-reproject";
import type { Texture } from "@luma.gl/core";
import type { ProjectedTileMetadata } from "./custom-projection-tileset-2d.js";
import { CustomProjectionTileset2D } from "./custom-projection-tileset-2d.js";
import type {
  CustomProjectionViewportLike,
  ProjectionContext,
} from "./projection-context.js";
import {
  createProjectionContext,
  isCustomProjectionViewport,
} from "./projection-context.js";
import { pixelRectToTriangulation } from "./tile-geometry.js";

/** Same shape as `COGLayer`'s (unexported) default tile data. */
type DefaultDataT = MinimalTileData & { texture: Texture; byteLength: number };

/** Props for {@link ProjectedCOGLayer}. */
export type ProjectedCOGLayerProps<
  DataT extends MinimalTileData = DefaultDataT,
> = COGLayerProps<DataT> & {
  /**
   * The view's projection domain in lng/lat (the view's `fromBounds`). Tiles
   * outside it are skipped, and geographic tiles crossing its edge are
   * trimmed; without a domain, polar views fetch tiles from the wrong
   * hemisphere and draw them clamped onto the map's rim. Defaults to the
   * viewport's `fromBounds`, which only this example's shim exposes:
   * upstream's viewport keeps it private, so pass it explicitly there.
   */
  fromBounds?: Bounds;
};

type SubLayerProps<DataT> = TileLayerProps<DataT> & {
  id: string;
  data?: DataT;
  tile: Tile2DHeader<DataT>;
};

/**
 * A `COGLayer` that also renders in a custom (planar) projection view.
 *
 * In a custom-projection viewport — this example's interim
 * `CustomProjectionView` shim today, upstream deck.gl's experimental
 * `_CustomProjectionView` once it ships — it replaces `COGLayer`'s Web
 * Mercator / globe tile pipeline with:
 *
 * - {@link CustomProjectionTileset2D}, which selects tiles in the view's map
 *   CRS, and
 * - one `RasterLayer` per tile whose reprojection target is map meters, drawn
 *   with `coordinateSystem: "cartesian"` (upstream's convention for
 *   preprojected positions). `RasterLayer` already splits positions into
 *   fp64 high/low parts, so tiles stay precise at high zoom.
 *
 * In any other view it behaves exactly like `COGLayer`. Everything else —
 * fetching, decoding, the default render pipeline, custom `getTileData` /
 * `renderTile` — is inherited.
 *
 * This lives in the example rather than in deck.gl-raster while upstream's
 * API settles. Folding it into the library would mean a third traversal mode
 * in `RasterTileset2D` and a third branch in `RasterTileLayer`'s sub-layer
 * rendering.
 */
export class ProjectedCOGLayer<
  DataT extends MinimalTileData = DefaultDataT,
> extends COGLayer<DataT> {
  static override layerName = "ProjectedCOGLayer";

  declare state: COGLayer<DataT>["state"] & {
    /** Memoized source ↔ map projection functions; see `_projectionContext`. */
    projectionContext?: ProjectionContext;
    projectionDescriptor?: RasterTilesetDescriptor;
    /**
     * `projectionSignature` of the viewport at the last `renderLayers` call
     * (`null` for a non-custom viewport).
     */
    renderedSignature?: string | null;
  };

  constructor(...propObjects: Partial<ProjectedCOGLayerProps<DataT>>[]) {
    super(...(propObjects as Partial<COGLayerProps<DataT>>[]));
  }

  /**
   * Also re-render when the view's projection changes. deck.gl only calls a
   * composite layer's `renderLayers` when the layer itself updates, and a
   * viewport change alone doesn't count (deck.gl 9.4 has no "projection
   * changed" flag), so without this the layer would keep drawing tiles for
   * the previous projection.
   */
  override shouldUpdateState(params: UpdateParameters<this>): boolean {
    return (
      super.shouldUpdateState(params) ||
      viewportSignature(this.context.viewport) !== this.state.renderedSignature
    );
  }

  override renderLayers(): Layer | null {
    const { viewport } = this.context;
    // Assigned directly rather than through setState, which would schedule
    // another render from inside renderLayers.
    this.state.renderedSignature = viewportSignature(viewport);
    if (!isCustomProjectionViewport(viewport)) {
      return super.renderLayers();
    }

    const descriptor = this._tilesetDescriptor();
    const getTileData = this._getTileDataCallback();
    const renderTile = this._renderTileCallback();
    if (!descriptor || !getTileData || !renderTile) {
      return null;
    }

    const projection = this._projectionContext(viewport, descriptor);
    return this._renderProjectedTileLayer(
      descriptor,
      projection,
      getTileData,
      renderTile,
    );
  }

  /**
   * The projection functions for the current descriptor and projection.
   *
   * They must keep their identity across renders: `RasterLayer` regenerates
   * a tile's mesh whenever a reprojection function changes. They are cached
   * by direct assignment rather than `setState`, which would schedule
   * another render from inside `renderLayers`.
   */
  private _projectionContext(
    viewport: Viewport & CustomProjectionViewportLike,
    descriptor: RasterTilesetDescriptor,
  ): ProjectionContext {
    const fromBounds =
      (this.props as ProjectedCOGLayerProps<DataT>).fromBounds ??
      viewport.fromBounds;
    const cached = this.state.projectionContext;
    if (
      cached &&
      cached.signature === viewport.projectionSignature &&
      sameBounds(cached.fromBounds, fromBounds) &&
      this.state.projectionDescriptor === descriptor
    ) {
      return cached;
    }
    const projection = createProjectionContext(
      viewport,
      descriptor,
      fromBounds,
    );
    this.state.projectionContext = projection;
    this.state.projectionDescriptor = descriptor;
    return projection;
  }

  private _renderProjectedTileLayer(
    descriptor: RasterTilesetDescriptor,
    projection: ProjectionContext,
    getTileData: NonNullable<RasterTileLayerProps<DataT>["getTileData"]>,
    renderTile: NonNullable<RasterTileLayerProps<DataT>["renderTile"]>,
  ): TileLayer<DataT> {
    // Effective device-pixel ratio, sampled on each traversal (see
    // RasterTileLayer for why this reads the drawing buffer size).
    const { device } = this.context;
    const getPixelRatio = () => {
      const canvas = device.getDefaultCanvasContext();
      const [drawingBufferWidth] = canvas.getDrawingBufferSize();
      const [cssWidth] = canvas.getCSSSize();
      return cssWidth ? drawingBufferWidth / cssWidth : 1;
    };
    class TilesetFactory extends CustomProjectionTileset2D {
      constructor(opts: Tileset2DProps) {
        super(opts, descriptor, projection, { getPixelRatio });
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
      onViewportLoad,
    } = this.props;

    return new TileLayer<DataT>({
      // deck.gl builds the tileset once per TileLayer, and the tileset bakes
      // in the projection, so a new projection gets a new TileLayer (as
      // upstream recommends when switching projections).
      id: `projected-tile-layer-${this.id}-${projection.signature}-${projection.fromBounds?.join(",") ?? "world"}`,
      TilesetClass: TilesetFactory,
      getTileData: (tile) => this._getProjectedTileData(tile, getTileData),
      renderSubLayers: (props) =>
        this._renderProjectedSubLayers(
          props as SubLayerProps<DataT>,
          projection,
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
      onTileUnload: this._onTileUnloadCallback(),
      onViewportLoad,
    });
  }

  /** Mirrors `RasterTileLayer`'s signal composition for tile fetches. */
  private _getProjectedTileData(
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

  private _renderProjectedSubLayers(
    props: SubLayerProps<DataT>,
    projection: ProjectionContext,
    renderTile: NonNullable<RasterTileLayerProps<DataT>["renderTile"]>,
  ): Layer[] {
    const { maxError, debug, debugOpacity } = this.props;
    const tile = props.tile as Tile2DHeader<DataT> & ProjectedTileMetadata;

    const debugLayers: Layer[] = debug
      ? [
          new PathLayer(
            this.getSubLayerProps({
              id: `${props.id}-outline`,
              data: [tile.mapRing],
              getPath: (ring: [number, number][]) => [...ring, ring[0]!],
              getColor: [255, 64, 160],
              getWidth: 1.5,
              widthUnits: "pixels",
              coordinateSystem: "cartesian",
            }),
          ),
        ]
      : [];

    if (!props.data || tile.outsideDomain) {
      return debugLayers;
    }
    const tileResult = renderTile(props.data);
    if (!tileResult) {
      return debugLayers;
    }
    const { image, renderPipeline } = tileResult;
    const { width, height } = props.data;

    const rasterLayer = new RasterLayer(
      this.getSubLayerProps({
        id: `${props.id}-raster`,
        height,
        // Passing `image: undefined` explicitly causes a black flash; see
        // RasterTileLayer.
        ...(image !== undefined && { image }),
        renderPipeline,
        maxError,
        // `width` only sizes the pixel grid the mesh is refined on; stretching
        // it with the transforms reweighs column error without changing the
        // mesh's UVs. See `ProjectedTileMetadata.meshXScale`.
        width: width * tile.meshXScale,
        reprojectionFns: {
          forwardTransform: tile.meshForwardTransform,
          inverseTransform: tile.meshInverseTransform,
          forwardReproject: projection.sourceToMap,
          inverseReproject: tile.inverseReproject,
        },
        initialTriangulation: domainSeed(tile, width, height),
        debug,
        debugOpacity,
        coordinateSystem: "cartesian",
      }),
    );
    return [rasterLayer, ...debugLayers];
  }
}

/** Whether two optional bounds are equal by value. */
function sameBounds(a: Bounds | undefined, b: Bounds | undefined): boolean {
  return a === b || (!!a && !!b && a.every((value, i) => value === b[i]));
}

/** A viewport's `projectionSignature`, or `null` if it has no custom projection. */
function viewportSignature(viewport: Viewport): string | null {
  return isCustomProjectionViewport(viewport)
    ? viewport.projectionSignature
    : null;
}

/**
 * The mesh seed that trims `tile` to the projection's domain, for a decoded
 * tile of `width` × `height` pixels. Cached on the tile so the seed keeps its
 * identity across renders (`RasterLayer` re-meshes when it changes).
 */
function domainSeed(
  tile: ProjectedTileMetadata,
  width: number,
  height: number,
): InitialTriangulation | undefined {
  const { domainPixelRect } = tile;
  if (!domainPixelRect) {
    return undefined;
  }
  const cached = tile._domainSeed;
  if (cached && cached.width === width && cached.height === height) {
    return cached.seed;
  }
  const seed = pixelRectToTriangulation(domainPixelRect, width, height);
  tile._domainSeed = { width, height, seed };
  return seed;
}
