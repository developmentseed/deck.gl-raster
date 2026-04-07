import type {
  CompositeLayerProps,
  Layer,
  LayerProps,
  LayersList,
  UpdateParameters,
} from "@deck.gl/core";
import { COORDINATE_SYSTEM, CompositeLayer } from "@deck.gl/core";
import type {
  _Tile2DHeader as Tile2DHeader,
  TileLayerProps,
  _TileLoadProps as TileLoadProps,
  _Tileset2DProps as Tileset2DProps,
} from "@deck.gl/geo-layers";
import { TileLayer } from "@deck.gl/geo-layers";
import * as affineLib from "@developmentseed/affine";
import { RasterLayer, RasterTileset2D } from "@developmentseed/deck.gl-raster";
import type { GeoZarrMetadata } from "@developmentseed/geozarr";
import { parseGeoZarrMetadata } from "@developmentseed/geozarr";
import type {
  EpsgResolver,
  ProjectionDefinition,
  ProjJson,
} from "@developmentseed/proj";
import {
  epsgResolver,
  makeClampedForwardTo3857,
  metersPerUnit,
  parseWkt,
} from "@developmentseed/proj";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import proj4 from "proj4";
import * as zarr from "zarrita";
import { geoZarrToDescriptor } from "./zarr-tileset.js";

/** Size of deck.gl's common coordinate space in world units. */
const TILE_SIZE = 512;

/** Size of the globe in web mercator meters. */
const WEB_MERCATOR_METER_CIRCUMFERENCE = 40075016.686;

/** Scale factor for converting EPSG:3857 meters into deck.gl world units. */
const WEB_MERCATOR_TO_WORLD_SCALE =
  TILE_SIZE / WEB_MERCATOR_METER_CIRCUMFERENCE;

/**
 * Props for the {@link ZarrLayer}.
 */
export type ZarrLayerProps<
  Store extends zarr.Readable = zarr.Readable,
  Dtype extends zarr.DataType = zarr.DataType,
> = CompositeLayerProps &
  Pick<
    TileLayerProps,
    | "debounceTime"
    | "maxCacheSize"
    | "maxCacheByteSize"
    | "maxRequests"
    | "refinementStrategy"
  > & {
    /** URL to the Zarr v3 store root. */
    source: string | URL | zarr.Array<Dtype, Store> | zarr.Group<Store>;

    /**
     * Optional path within the store to the variable group.
     * If omitted, the root group is used.
     */
    variable?: string;

    /**
     * Index to use for non-spatial dimensions (e.g. `{ time: 0, band: 2 }`).
     * Defaults to 0 for any unspecified dimension.
     */
    dimensionIndices?: Record<string, number>;

    /**
     * Resolver for authority:code CRS strings (e.g. "EPSG:4326").
     * Defaults to fetching from epsg.io.
     */
    epsgResolver?: EpsgResolver;

    /** Maximum reprojection error in pixels for mesh refinement. @default 0.125 */
    maxError?: number;

    /** Enable debug tile outline visualization. @default false */
    debug?: boolean;

    /** Opacity of the debug mesh overlay (0-1). @default 0.5 */
    debugOpacity?: number;

    /** Called when Zarr metadata has been loaded and parsed. */
    // TODO: restore onZarrLoad once we understand what metadata we should pass
    // through it.
    // onZarrLoad?: (meta: GeoZarrMetadata) => void;

    /** User-provided AbortSignal to cancel loading. */
    signal?: AbortSignal;
  };

const defaultProps: Partial<ZarrLayerProps> = {
  ...TileLayer.defaultProps,
  epsgResolver,
  debug: false,
  debugOpacity: 0.5,
};

type TileData = {
  image: ImageData;
  forwardTransform: ReprojectionFns["forwardTransform"];
  inverseTransform: ReprojectionFns["inverseTransform"];
  width: number;
  height: number;
};

/**
 * ZarrLayer renders a GeoZarr dataset using a tiled approach with reprojection.
 */
export class ZarrLayer extends CompositeLayer<ZarrLayerProps> {
  static override layerName = "ZarrLayer";
  static override defaultProps = defaultProps;

  declare state: {
    meta?: GeoZarrMetadata;
    /** One opened array per level, finest-first (matches meta.levels order). */
    arrays?: zarr.Array<zarr.DataType, zarr.Readable>[];
    forwardTo4326?: ReprojectionFns["forwardReproject"];
    inverseFrom4326?: ReprojectionFns["inverseReproject"];
    forwardTo3857?: ReprojectionFns["forwardReproject"];
    inverseFrom3857?: ReprojectionFns["inverseReproject"];
    mpu?: number;
  };

  override initializeState(): void {
    this.setState({});
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params);

    const { props, oldProps, changeFlags } = params;

    const needsUpdate =
      Boolean(changeFlags.dataChanged) ||
      props.source !== oldProps.source ||
      props.variable !== oldProps.variable;

    if (needsUpdate) {
      // Clear stale state so renderLayers returns null until the new GeoTIFF is
      // ready
      this._clearState();
      void this._parseZarr();
    }
  }

  _clearState() {
    this.setState({
      meta: undefined,
      arrays: undefined,
      forwardTo4326: undefined,
      inverseFrom4326: undefined,
      forwardTo3857: undefined,
      inverseFrom3857: undefined,
      mpu: undefined,
    });
  }

  async _parseZarr(): Promise<void> {
    const { source, variable } = this.props;

    const store = new zarr.FetchStore(source.toString());
    // @ts-expect-error - for debugging
    window.store = store;

    const root = await zarr.open(store);
    // @ts-expect-error - for debugging
    window.root = root;

    const group = variable
      ? await zarr.open(root.resolve(variable), { kind: "group" })
      : root;
    // @ts-expect-error - for debugging
    window.group = group;

    const meta = parseGeoZarrMetadata(group.attrs);
    // @ts-expect-error - for debugging
    window.meta = meta;

    // Open each level's array once and keep the references in state.
    // This avoids re-fetching array metadata on every tile request.
    const arrays = await Promise.all(
      meta.levels.map((level) =>
        zarr.open(group.resolve(level.path), { kind: "array" }),
      ),
    );

    // Resolve CRS
    const { crs } = meta;
    let sourceProjection: ProjectionDefinition;

    if (crs.code) {
      const [authority, code] = crs.code.split(":");
      if (authority !== "EPSG") {
        throw new Error(
          `Unsupported CRS authority "${authority}". Only "EPSG" is supported.`,
        );
      }
      if (!code) {
        throw new Error(
          `Invalid CRS code "${crs.code}". Expected format "EPSG:XXXX".`,
        );
      }
      sourceProjection = await this.props.epsgResolver!(
        Number.parseInt(code, 10),
      );
    } else if (crs.wkt2) {
      sourceProjection = parseWkt(crs.wkt2);
    } else if (crs.projjson) {
      sourceProjection = parseWkt(crs.projjson as unknown as ProjJson);
    } else {
      throw new Error("No CRS information found in GeoZarr metadata");
    }

    // Build proj4 converters
    // @ts-expect-error - proj4 typings don't cover wkt-parser output
    const converter4326 = proj4(sourceProjection, "EPSG:4326");
    const forwardTo4326 = (x: number, y: number) =>
      converter4326.forward<[number, number]>([x, y], false);
    const inverseFrom4326 = (x: number, y: number) =>
      converter4326.inverse<[number, number]>([x, y], false);

    // @ts-expect-error - proj4 typings don't cover wkt-parser output
    const converter3857 = proj4(sourceProjection, "EPSG:3857");
    const forwardTo3857Raw = (x: number, y: number) =>
      converter3857.forward<[number, number]>([x, y], false);
    const forwardTo3857 = makeClampedForwardTo3857(
      forwardTo3857Raw,
      forwardTo4326,
    );
    const inverseFrom3857 = (x: number, y: number) =>
      converter3857.inverse<[number, number]>([x, y], false);

    // Compute meters-per-CRS-unit from the resolved projection
    const units: string = sourceProjection.units ?? "m";
    const semiMajorAxis: number | undefined =
      sourceProjection.datum?.a ?? sourceProjection.a;
    const mpu = metersPerUnit(units as Parameters<typeof metersPerUnit>[0], {
      semiMajorAxis,
    });

    this.setState({
      meta,
      arrays,
      forwardTo4326,
      inverseFrom4326,
      forwardTo3857,
      inverseFrom3857,
      mpu,
    });
  }

  async _getTileData(
    tile: TileLoadProps,
    meta: GeoZarrMetadata,
    arrays: zarr.Array<zarr.DataType, zarr.Readable>[],
  ): Promise<TileData> {
    const { x, y, z } = tile.index;
    const { dimensionIndices = {} } = this.props;

    // descriptor z=0 is coarsest; meta.levels is finest-first
    // so descriptor level z maps to meta.levels[numLevels - 1 - z]
    const zarrLevelIdx = meta.levels.length - 1 - z;
    const level = meta.levels[zarrLevelIdx]!;
    const arr = arrays[zarrLevelIdx]!;

    // chunks is [...otherDims, chunkHeight, chunkWidth]
    const tileWidth = arr.chunks[arr.chunks.length - 1]!;
    const tileHeight = arr.chunks[arr.chunks.length - 2]!;

    // Build slice spec for all dimensions
    // The last two dims are y (height) and x (width); others use dimensionIndices
    const rowStart = y * tileHeight;
    const rowEnd = Math.min((y + 1) * tileHeight, level.arrayHeight);
    const colStart = x * tileWidth;
    const colEnd = Math.min((x + 1) * tileWidth, level.arrayWidth);

    const actualHeight = rowEnd - rowStart;
    const actualWidth = colEnd - colStart;

    // Build slice for each dimension
    const slices: (zarr.Slice | number)[] = arr.shape.map((_, dimIdx) => {
      const numDims = arr.shape.length;
      if (dimIdx === numDims - 2) {
        // y dimension
        return zarr.slice(rowStart, rowEnd);
      }
      if (dimIdx === numDims - 1) {
        // x dimension
        return zarr.slice(colStart, colEnd);
      }
      // Other dimensions: use dimensionIndices or 0
      const dimName = meta.axes[dimIdx] ?? String(dimIdx);
      return dimensionIndices[dimName] ?? 0;
    });

    const result = await zarr.get(arr, slices);

    // Compute per-tile affine: compose level affine with pixel offset of this tile
    const tileOffset = affineLib.translation(colStart, rowStart);
    const tileAffine = affineLib.compose(level.affine, tileOffset);
    const invTileAffine = affineLib.invert(tileAffine);

    const forwardTransform = (px: number, py: number) =>
      affineLib.apply(tileAffine, px, py);
    const inverseTransform = (cx: number, cy: number) =>
      affineLib.apply(invTileAffine, cx, cy);

    const image = toImageData(result as NDArrayLike, actualWidth, actualHeight);

    return {
      image,
      forwardTransform,
      inverseTransform,
      width: actualWidth,
      height: actualHeight,
    };
  }

  _renderSubLayers(
    props: TileLayerProps<TileData> & {
      id: string;
      data?: TileData;
      _offset: number;
      tile: Tile2DHeader<TileData>;
    },
    forwardTo4326: ReprojectionFns["forwardReproject"],
    inverseFrom4326: ReprojectionFns["inverseReproject"],
    forwardTo3857: ReprojectionFns["forwardReproject"],
    inverseFrom3857: ReprojectionFns["inverseReproject"],
  ): Layer | LayersList | null {
    const { maxError, debug, debugOpacity } = this.props;

    if (!props.data) {
      return null;
    }

    const { image, forwardTransform, inverseTransform, width, height } =
      props.data;

    const isGlobe = this.context.viewport.resolution !== undefined;
    let reprojectionFns: ReprojectionFns;
    let deckProjectionProps: Partial<LayerProps>;

    if (isGlobe) {
      reprojectionFns = {
        forwardTransform,
        inverseTransform,
        forwardReproject: forwardTo4326,
        inverseReproject: inverseFrom4326,
      };
      deckProjectionProps = {};
    } else {
      reprojectionFns = {
        forwardTransform,
        inverseTransform,
        forwardReproject: forwardTo3857,
        inverseReproject: inverseFrom3857,
      };
      deckProjectionProps = {
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        coordinateOrigin: [TILE_SIZE / 2, TILE_SIZE / 2, 0],
        // biome-ignore format: array
        modelMatrix: [
          WEB_MERCATOR_TO_WORLD_SCALE, 0, 0, 0,
          0, WEB_MERCATOR_TO_WORLD_SCALE, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1
        ],
      };
    }

    return new RasterLayer(
      this.getSubLayerProps({
        id: `${props.id}-raster`,
        image,
        width,
        height,
        maxError,
        reprojectionFns,
        debug,
        debugOpacity,
        ...deckProjectionProps,
      }),
    );
  }

  renderTileLayer(
    meta: GeoZarrMetadata,
    arrays: zarr.Array<zarr.DataType, zarr.Readable>[],
    mpu: number,
    forwardTo4326: ReprojectionFns["forwardReproject"],
    inverseFrom4326: ReprojectionFns["inverseReproject"],
    forwardTo3857: ReprojectionFns["forwardReproject"],
    inverseFrom3857: ReprojectionFns["inverseReproject"],
  ): TileLayer {
    const chunkSizes = arrays.map((arr) => ({
      width: arr.chunks[arr.chunks.length - 1]!,
      height: arr.chunks[arr.chunks.length - 2]!,
    }));

    class ZarrTilesetFactory extends RasterTileset2D {
      constructor(opts: Tileset2DProps) {
        const descriptor = geoZarrToDescriptor(
          meta,
          forwardTo4326,
          forwardTo3857,
          chunkSizes,
          mpu,
        );
        super(opts, descriptor, { projectTo4326: forwardTo4326 });
      }
    }

    const {
      maxRequests,
      maxCacheSize,
      maxCacheByteSize,
      debounceTime,
      refinementStrategy,
    } = this.props;

    return new TileLayer<TileData>({
      id: `zarr-tile-layer-${this.id}`,
      TilesetClass: ZarrTilesetFactory,
      getTileData: (tile) => this._getTileData(tile, meta, arrays),
      renderSubLayers: (props) =>
        this._renderSubLayers(
          props,
          forwardTo4326,
          inverseFrom4326,
          forwardTo3857,
          inverseFrom3857,
        ),
      debounceTime,
      maxCacheByteSize,
      maxCacheSize,
      maxRequests,
      refinementStrategy,
    });
  }

  override renderLayers() {
    const {
      meta,
      arrays,
      mpu,
      forwardTo4326,
      inverseFrom4326,
      forwardTo3857,
      inverseFrom3857,
    } = this.state;

    if (
      !meta ||
      !arrays ||
      mpu === undefined ||
      !forwardTo4326 ||
      !inverseFrom4326 ||
      !forwardTo3857 ||
      !inverseFrom3857
    ) {
      return null;
    }

    return this.renderTileLayer(
      meta,
      arrays,
      mpu,
      forwardTo4326,
      inverseFrom4326,
      forwardTo3857,
      inverseFrom3857,
    );
  }
}

/** Minimal interface for the data returned by zarrita.get */
type NDArrayLike = {
  data: ArrayLike<number>;
  shape: number[];
};

/**
 * Convert a band-planar zarr result to an RGBA ImageData.
 *
 * Supports:
 *  - shape [3, H, W]  → RGB  (alpha = 255)
 *  - shape [1, H, W]  → grayscale (R=G=B, alpha = 255)
 *  - shape [H, W]     → grayscale (R=G=B, alpha = 255)
 */
function toImageData(
  result: NDArrayLike,
  width: number,
  height: number,
): ImageData {
  const { data, shape } = result;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const numBands = shape.length >= 3 ? shape[shape.length - 3]! : 1;
  const pixelCount = width * height;

  if (numBands >= 3) {
    // Band-planar RGB: [3, H, W]
    const rOffset = 0;
    const gOffset = pixelCount;
    const bOffset = pixelCount * 2;
    for (let i = 0; i < pixelCount; i++) {
      rgba[i * 4 + 0] = data[rOffset + i]!;
      rgba[i * 4 + 1] = data[gOffset + i]!;
      rgba[i * 4 + 2] = data[bOffset + i]!;
      rgba[i * 4 + 3] = 255;
    }
  } else {
    // Single band: [1, H, W] or [H, W]
    for (let i = 0; i < pixelCount; i++) {
      const v = data[i]!;
      rgba[i * 4 + 0] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
  }

  return new ImageData(rgba, width, height);
}
