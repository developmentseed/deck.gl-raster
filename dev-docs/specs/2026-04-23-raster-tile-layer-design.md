# RasterTileLayer Design

## Problem

The `@developmentseed/deck.gl-raster` package provides `RasterLayer` (renders a single spatially-oriented texture) and tile utilities implementing `Tileset2D` (`RasterTileset2D`, `TileMatrixSetAdaptor`, `TilesetDescriptor`). Wiring these into a full tiled raster layer currently lives in `COGLayer` (in `deck.gl-geotiff`) and was largely duplicated into `ZarrLayer` (in `deck.gl-zarr`). Lonboard re-implements the same wiring a third time in its widget.

Duplicated logic across these consumers includes:

- Creating a `RasterTileset2D` factory subclass that captures the descriptor
- Instantiating the upstream `@deck.gl/geo-layers` `TileLayer`
- Wiring `getTileData` / `renderSubLayers`
- Globe vs. Web Mercator coordinate system handling (`COORDINATE_SYSTEM.CARTESIAN`, `modelMatrix`, `coordinateOrigin`)
- Per-tile `RasterLayer` construction with `reprojectionFns` and debug tile outlines
- Forwarding `TileLayer` passthrough props
- Combining the user's `signal` prop with `TileLayer`'s per-tile `AbortSignal`

## Goals

- Introduce `RasterTileLayer` in `@developmentseed/deck.gl-raster` that encapsulates the shared tiled-raster infrastructure.
- Make it directly usable by any consumer that can produce a `TilesetDescriptor` (notably Lonboard).
- Make it subclassable so source-specific layers like `COGLayer` and `ZarrLayer` can expose a single "parse this source" prop to end users.
- Migrate `COGLayer` and `ZarrLayer` to subclass `RasterTileLayer` without changing their public API.

Inspired by `@deck.gl/geo-layers`'s [`MVTLayer extends TileLayer`](https://github.com/visgl/deck.gl/blob/ddb6fc26e54683f81170105044b7fe8eee69d286/modules/geo-layers/src/mvt-layer/mvt-layer.ts#L111-L117) pattern: the base class is usable directly, and subclasses customize by overriding protected methods and adding their own props.

## Non-Goals

- Changing the public API of `COGLayer` or `ZarrLayer`.
- Supporting per-tile transforms returned from `getTileData` (consumer-supplied transforms attached to fetched data). The descriptor owns transforms; if a future use case requires per-tile overrides, an optional return field can be added without breaking the current contract.
- Ground Control Points (GCPs). The descriptor's per-tile `tileTransform` interface can represent non-affine transforms, but no GCP-based descriptor implementation is part of this work.

## Design

### 1. Architecture

`RasterTileLayer` is a new `CompositeLayer` in `packages/deck.gl-raster/src/raster-tile-layer/`. It renders a child `TileLayer` from `@deck.gl/geo-layers`, handling all shared wiring.

Two consumption modes, both first-class:

- **Direct use** (Lonboard): consumer passes `tilesetDescriptor`, `getTileData`, `renderTile` as props.
- **Subclassing** (`COGLayer`, `ZarrLayer`): subclass adds its own props (`geotiff`, `source`, etc.), parses asynchronously in `updateState`, and exposes the three via its own state by overriding a small set of `protected` accessor methods.

The base class reads each of the three through a protected accessor (`_getTilesetDescriptor()` / `_getGetTileData()` / `_getRenderTile()`) that by default returns the corresponding prop. Subclasses override these accessors to pull from their own state (with or without falling back to props). `renderLayers()` returns `null` until all three accessors return non-undefined values.

The base class itself has no declared state — each subclass owns its own state shape.

### 2. `RasterTileLayer` class

```ts
export class RasterTileLayer<
  DataT extends MinimalDataT = MinimalDataT,
  ExtraProps extends {} = {},
> extends CompositeLayer<Required<RasterTileLayerProps<DataT>> & ExtraProps> {
  static layerName = "RasterTileLayer";
  static defaultProps = {
    ...TileLayer.defaultProps,
    maxError: 0.125,
    debug: false,
    debugOpacity: 0.5,
  };

  initializeState(): void {
    this.setState({});
  }

  protected _getTilesetDescriptor(): TilesetDescriptor | undefined {
    return this.props.tilesetDescriptor;
  }
  protected _getGetTileData(): RasterTileLayerProps<DataT>["getTileData"] {
    return this.props.getTileData;
  }
  protected _getRenderTile(): RasterTileLayerProps<DataT>["renderTile"] {
    return this.props.renderTile;
  }

  renderLayers(): Layer | null {
    const descriptor = this._getTilesetDescriptor();
    const getTileData = this._getGetTileData();
    const renderTile = this._getRenderTile();
    if (!descriptor || !getTileData || !renderTile) return null;
    return this._renderTileLayer(descriptor, getTileData, renderTile);
  }

  // _renderTileLayer, _wrapGetTileData, _renderSubLayers — see §4
}
```

### 3. Props

```ts
export type MinimalDataT = {
  /** Tile height in pixels. */
  height: number;
  /** Tile width in pixels. */
  width: number;
  /** Byte length of data, used when `maxCacheByteSize` is set. */
  byteLength?: number;
};

export type GetTileDataOptions = {
  /** The luma.gl Device. */
  device?: Device;
  /** Combined AbortSignal (user's `signal` prop + TileLayer's per-tile signal). */
  signal?: AbortSignal;
};

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
      /** Tile pyramid + CRS projection descriptor. Subclasses may supply via state. */
      tilesetDescriptor?: TilesetDescriptor;

      /** Fetch data for one tile. Subclasses may supply via state. */
      getTileData?: (
        tile: TileLoadProps,
        options: GetTileDataOptions,
      ) => Promise<DataT>;

      /** Turn cached tile data into a render result. Subclasses may supply via state. */
      renderTile?: (data: DataT) => RenderTileResult;

      /** Mesh reprojection error threshold in pixels. @default 0.125 */
      maxError?: number;

      /** Show triangulation mesh + tile outlines. @default false */
      debug?: boolean;

      /** Opacity of debug mesh overlay. @default 0.5 */
      debugOpacity?: number;

      /** Abort signal applied to every tile fetch. */
      signal?: AbortSignal;
    };
```

`tilesetDescriptor`, `getTileData`, and `renderTile` are optional at the type level so subclasses don't have to pass them as props — the runtime null-check in `renderLayers()` enforces that each protected accessor returns a non-undefined value before the child `TileLayer` is created.

### 4. Internal rendering

```ts
private _renderTileLayer(
  descriptor: TilesetDescriptor,
  getTileData: NonNullable<RasterTileLayerProps<DataT>["getTileData"]>,
  renderTile: NonNullable<RasterTileLayerProps<DataT>["renderTile"]>,
): TileLayer {
  class TilesetFactory extends RasterTileset2D {
    constructor(opts: Tileset2DProps) {
      super(opts, descriptor);
    }
  }

  const {
    tileSize, zoomOffset, maxZoom, minZoom, extent,
    debounceTime, maxCacheSize, maxCacheByteSize, maxRequests, refinementStrategy,
  } = this.props;

  return new TileLayer<DataT>({
    id: `raster-tile-layer-${this.id}`,
    TilesetClass: TilesetFactory,
    getTileData: (tile) => this._wrapGetTileData(tile, getTileData),
    renderSubLayers: (props) =>
      this._renderSubLayers(props, descriptor, renderTile),
    tileSize, zoomOffset, maxZoom, minZoom, extent,
    debounceTime, maxCacheSize, maxCacheByteSize, maxRequests, refinementStrategy,
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
  return getTileData(tile, { device: this.context.device, signal });
}

private _renderSubLayers(
  props: TileLayerProps<DataT> & {
    id: string;
    data?: DataT;
    _offset: number;
    tile: Tile2DHeader<DataT>;
  },
  descriptor: TilesetDescriptor,
  renderTile: NonNullable<RasterTileLayerProps<DataT>["renderTile"]>,
): Layer[] {
  const { maxError, debug, debugOpacity } = this.props;
  const tile = props.tile as Tile2DHeader<DataT> & TileMetadata;

  const layers: Layer[] = [];
  if (debug) {
    layers.push(
      ...renderDebugTileOutline(
        `${this.id}-${tile.id}-bounds`,
        tile,
        descriptor.projectTo4326,
      ),
    );
  }
  if (!props.data) return layers;

  const { x, y, z } = tile.index;
  const { forwardTransform, inverseTransform } =
    descriptor.levels[z]!.tileTransform(x, y);
  const { image, renderPipeline } = renderTile(props.data);
  const { width, height } = props.data;

  const isGlobe = this.context.viewport.resolution !== undefined;
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
        forwardReproject: descriptor.projectTo3857,
        inverseReproject: descriptor.projectFrom3857,
      };
  const deckProjectionProps: Partial<LayerProps> = isGlobe
    ? {}
    : {
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        coordinateOrigin: [TILE_SIZE / 2, TILE_SIZE / 2, 0],
        modelMatrix: [
          WEB_MERCATOR_TO_WORLD_SCALE, 0, 0, 0,
          0, WEB_MERCATOR_TO_WORLD_SCALE, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ],
      };

  const rasterLayer = new RasterLayer(
    this.getSubLayerProps({
      id: `${props.id}-raster`,
      width,
      height,
      ...(image !== undefined && { image }),
      renderPipeline,
      maxError,
      reprojectionFns,
      debug,
      debugOpacity,
      ...deckProjectionProps,
    }),
  );
  return [rasterLayer, ...layers];
}
```

### 5. Descriptor interface changes

`TilesetDescriptor` carries all four projection functions (adds inverses); `TilesetLevel` gains a `tileTransform(col, row)` method.

```ts
interface TilesetDescriptor {
  levels: TilesetLevel[];
  projectedBounds: Bounds;

  projectTo4326: ProjectionFunction;
  projectFrom4326: ProjectionFunction; // new
  projectTo3857: ProjectionFunction;
  projectFrom3857: ProjectionFunction; // new
}

interface TilesetLevel {
  matrixWidth: number;
  matrixHeight: number;
  tileWidth: number;
  tileHeight: number;
  metersPerPixel: number;
  projectedTileCorners(col: number, row: number): Corners;
  crsBoundsToTileRange(
    minX: number, minY: number, maxX: number, maxY: number,
  ): { minCol: number; maxCol: number; minRow: number; maxRow: number };

  /** New: per-tile forward/inverse coordinate transforms (pixel ↔ CRS). */
  tileTransform(col: number, row: number): {
    forwardTransform: (x: number, y: number) => [number, number];
    inverseTransform: (x: number, y: number) => [number, number];
  };
}
```

`RasterTileset2D`'s constructor drops its third-argument `{ projectTo4326 }` config bundle and reads that function from the descriptor.

Implementation sources for `tileTransform`:

- `TileMatrixSetAdaptor` → morecantile's `tileTransform(tileMatrix, { col, row })`, the same code currently inline in `COGLayer._getTileData`.
- GeoZarr descriptor → `affine.compose(level.affine, affine.translation(col * chunkWidth, row * chunkHeight))`, the same code currently inline in `ZarrLayer._getTileData`.

### 6. Consumer migration

**`COGLayer`:**

```ts
export type COGLayerProps<DataT extends MinimalDataT = DefaultDataT> =
  Omit<RasterTileLayerProps<DataT>, "tilesetDescriptor" | "getTileData" | "renderTile"> &
  COGLayerDataProps<DataT> & {
    geotiff: GeoTIFF | string | URL | ArrayBuffer;
    epsgResolver?: EpsgResolver;
    pool?: DecoderPool;
    /** Same shape as today — geographicBounds, projection unchanged. */
    onGeoTIFFLoad?: (...) => void;
  };

export class COGLayer<DataT extends MinimalDataT = DefaultDataT>
  extends RasterTileLayer<DataT, COGLayerProps<DataT>>
{
  static layerName = "COGLayer";
  static defaultProps = { ...RasterTileLayer.defaultProps, epsgResolver };

  declare state: {
    geotiff?: GeoTIFF;
    tilesetDescriptor?: TilesetDescriptor;
    defaultGetTileData?: COGLayerProps<TextureDataT>["getTileData"];
    defaultRenderTile?: COGLayerProps<TextureDataT>["renderTile"];
  };

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);
    const { props, oldProps, changeFlags } = params;
    if (changeFlags.dataChanged || props.geotiff !== oldProps.geotiff) {
      this._clearState();
      void this._parseGeoTIFF();
    }
  }

  private async _parseGeoTIFF() {
    const geotiff = await fetchGeoTIFF(this.props.geotiff);
    // ... build proj4 converters for 4326 + 3857 (both directions) ...
    const descriptor = new TileMatrixSetAdaptor(tms, {
      projectTo4326, projectFrom4326, projectTo3857, projectFrom3857,
    });
    let defaultGetTileData, defaultRenderTile;
    if (!this.props.getTileData || !this.props.renderTile) {
      ({ getTileData: defaultGetTileData, renderTile: defaultRenderTile } =
        inferRenderPipeline(geotiff, this.context.device));
    }
    this.setState({
      geotiff,
      tilesetDescriptor: descriptor,
      defaultGetTileData,
      defaultRenderTile,
    });
    this.props.onGeoTIFFLoad?.(geotiff, { projection, geographicBounds });
  }

  protected override _getTilesetDescriptor() {
    return this.state.tilesetDescriptor;
  }

  // Adapt the user-facing `getTileData(image, options)` into the
  // `(tile, options) => Promise<DataT>` shape RasterTileLayer expects
  protected override _getGetTileData() {
    const geotiff = this.state.geotiff;
    if (!geotiff) return undefined;
    const userFn = this.props.getTileData ?? this.state.defaultGetTileData;
    if (!userFn) return undefined;
    return async (tile: TileLoadProps, options: GetTileDataOptions) => {
      const { x, y, z } = tile.index;
      const images = [geotiff, ...geotiff.overviews];
      const image = images[images.length - 1 - z]!;
      return userFn(image, {
        ...options,
        x,
        y,
        pool: this.props.pool ?? defaultDecoderPool(),
      });
    };
  }

  protected override _getRenderTile() {
    return this.props.renderTile ?? this.state.defaultRenderTile;
  }
}
```

`COGLayer`'s user-facing `getTileData(image, options)` signature (image-centric, not tile-centric) is unchanged; the adapter lives in `_getGetTileData`.

**`ZarrLayer`:** same pattern. No default `renderTile` (GeoZarr lacks metadata hints about expected rendering), so `renderTile` remains required to `ZarrLayer`'s users. `_getGetTileData` builds the zarr slice spec from the tile index + stored arrays.

**`MultiCOGLayer`:** adjusted to match `COGLayer`'s new base, no behavioral change.

### 7. File layout & public exports

New/modified files in `packages/deck.gl-raster/src/`:

```
raster-tile-layer/
  index.ts                    # barrel
  raster-tile-layer.ts        # RasterTileLayer class
  types.ts                    # RasterTileLayerProps, MinimalDataT,
                              # GetTileDataOptions
  constants.ts                # TILE_SIZE, WEB_MERCATOR_METER_CIRCUMFERENCE,
                              # WEB_MERCATOR_TO_WORLD_SCALE

raster-tileset/
  tileset-interface.ts        # modified: add projectFrom4326/projectFrom3857
                              # and TilesetLevel.tileTransform()
  tile-matrix-set.ts          # modified: take all 4 projections, implement
                              # tileTransform() via morecantile
  raster-tileset-2d.ts        # modified: read projectTo4326 from descriptor
                              # (drop third-arg config bundle)
```

Modified in `packages/deck.gl-geotiff/src/`:

```
cog-layer.ts                  # now extends RasterTileLayer
multi-cog-layer.ts            # adjusted to match COGLayer's new base
```

Modified in `packages/deck.gl-zarr/src/`:

```
zarr-layer.ts                 # now extends RasterTileLayer
zarr-tileset.ts               # geoZarrToDescriptor returns 4 projections
                              # + per-level tileTransform
```

Public exports from `@developmentseed/deck.gl-raster`:

```ts
// New
export { RasterTileLayer } from "./raster-tile-layer/index.js";
export type {
  RasterTileLayerProps,
  MinimalDataT,
  GetTileDataOptions,
} from "./raster-tile-layer/index.js";

// Existing (unchanged)
export { RasterLayer, RasterTileset2D, TileMatrixSetAdaptor };
export type {
  RenderTileResult,
  TilesetDescriptor,
  TilesetLevel,
  // ...
};
```

### 8. Testing

- Unit tests for `TilesetLevel.tileTransform` on both `TileMatrixSetAdaptor` and the GeoZarr descriptor, comparing outputs to the current inline math.
- Unit tests for `RasterTileLayer` with a synthetic descriptor + stub `getTileData`/`renderTile`: asserts `null` until prerequisites arrive, factory class passes descriptor to `RasterTileset2D`, `renderSubLayers` wires correct `reprojectionFns`, AbortSignal combination.
- Existing examples (`naip-mosaic`, `sentinel-2`, `land-cover`, `zarr-*`) render unchanged — manual smoke test in each.

No public API changes to `COGLayer`/`ZarrLayer`; all existing tests should pass without modification.
