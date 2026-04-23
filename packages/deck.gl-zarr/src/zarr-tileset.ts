import * as affine from "@developmentseed/affine";
import type {
  Bounds,
  Corners,
  ProjectionFunction,
  TilesetDescriptor,
  TilesetLevel,
} from "@developmentseed/deck.gl-raster";
import type {
  GeoZarrMetadata,
  MultiscaleLevel,
} from "@developmentseed/geozarr";

class ZarrTilesetLevel implements TilesetLevel {
  private level: MultiscaleLevel;
  private _tileWidth: number;
  private _tileHeight: number;
  private _mpu: number;
  private _invAffine: ReturnType<typeof affine.invert>;

  constructor(
    level: MultiscaleLevel,
    tileWidth: number,
    tileHeight: number,
    mpu: number,
  ) {
    this.level = level;
    this._tileWidth = tileWidth;
    this._tileHeight = tileHeight;
    this._mpu = mpu;
    this._invAffine = affine.invert(level.affine);
  }

  get matrixWidth(): number {
    return Math.ceil(this.level.arrayWidth / this._tileWidth);
  }

  get matrixHeight(): number {
    return Math.ceil(this.level.arrayHeight / this._tileHeight);
  }

  get tileWidth(): number {
    return this._tileWidth;
  }

  get tileHeight(): number {
    return this._tileHeight;
  }

  get metersPerPixel(): number {
    // Geometric mean of x and y pixel sizes handles non-square pixels
    const [a, , , , e] = this.level.affine;
    return Math.sqrt(Math.abs(a * e)) * this._mpu;
  }

  projectedTileCorners(col: number, row: number): Corners {
    const tw = this._tileWidth;
    const th = this._tileHeight;
    const af = this.level.affine;

    const topLeft = affine.apply(af, col * tw, row * th);
    const topRight = affine.apply(af, (col + 1) * tw, row * th);
    const bottomLeft = affine.apply(af, col * tw, (row + 1) * th);
    const bottomRight = affine.apply(af, (col + 1) * tw, (row + 1) * th);

    return { topLeft, topRight, bottomLeft, bottomRight };
  }

  /**
   * Compute forward and inverse per-tile pixel↔CRS transforms for the tile at
   * `(col, row)`. Composes the level affine with a pixel-offset translation so
   * that pixel `(0, 0)` of the tile maps to the correct CRS coordinate.
   */
  tileTransform(
    col: number,
    row: number,
  ): {
    forwardTransform: (x: number, y: number) => [number, number];
    inverseTransform: (x: number, y: number) => [number, number];
  } {
    const colStart = col * this._tileWidth;
    const rowStart = row * this._tileHeight;
    const tileOffset = affine.translation(colStart, rowStart);
    const tileAffine = affine.compose(this.level.affine, tileOffset);
    const invTileAffine = affine.invert(tileAffine);
    return {
      forwardTransform: (x, y) => affine.apply(tileAffine, x, y),
      inverseTransform: (x, y) => affine.apply(invTileAffine, x, y),
    };
  }

  crsBoundsToTileRange(
    projectedMinX: number,
    projectedMinY: number,
    projectedMaxX: number,
    projectedMaxY: number,
  ): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
    // Map all four CRS corners through the inverse affine to get pixel coords,
    // then take the bounding box in pixel space
    const inv = this._invAffine;
    const corners = [
      affine.apply(inv, projectedMinX, projectedMinY),
      affine.apply(inv, projectedMaxX, projectedMinY),
      affine.apply(inv, projectedMinX, projectedMaxY),
      affine.apply(inv, projectedMaxX, projectedMaxY),
    ];

    const pxCoords = corners.map(([px]) => px);
    const pyCoords = corners.map(([, py]) => py);

    const pixMinX = Math.min(...pxCoords);
    const pixMaxX = Math.max(...pxCoords);
    const pixMinY = Math.min(...pyCoords);
    const pixMaxY = Math.max(...pyCoords);

    const tw = this._tileWidth;
    const th = this._tileHeight;
    const maxCol = this.matrixWidth - 1;
    const maxRow = this.matrixHeight - 1;

    const minCol = Math.max(0, Math.min(maxCol, Math.floor(pixMinX / tw)));
    const hiCol = Math.max(0, Math.min(maxCol, Math.floor(pixMaxX / tw)));
    const minRow = Math.max(0, Math.min(maxRow, Math.floor(pixMinY / th)));
    const hiRow = Math.max(0, Math.min(maxRow, Math.floor(pixMaxY / th)));

    return { minCol, maxCol: hiCol, minRow, maxRow: hiRow };
  }
}

/**
 * Convert a `GeoZarrMetadata` object into a `TilesetDescriptor` for use with
 * `RasterTileset2D`.
 *
 * @param meta  Parsed GeoZarr metadata (from `parseGeoZarrMetadata`).
 * @param opts  Projection functions and tiling parameters:
 *   - `projectTo4326`:   Forward projection function: source CRS → EPSG:4326.
 *   - `projectFrom4326`: Inverse projection function: EPSG:4326 → source CRS.
 *   - `projectTo3857`:   Forward projection function: source CRS → EPSG:3857.
 *   - `projectFrom3857`: Inverse projection function: EPSG:3857 → source CRS.
 *   - `chunkSizes`:      Chunk (tile) width/height per level, in the same
 *                        finest-first order as `meta.levels`.
 *   - `mpu`:             Meters per CRS unit (computed from the resolved CRS).
 */
export function geoZarrToDescriptor(
  meta: GeoZarrMetadata,
  opts: {
    projectTo4326: ProjectionFunction;
    projectFrom4326: ProjectionFunction;
    projectTo3857: ProjectionFunction;
    projectFrom3857: ProjectionFunction;
    chunkSizes: Array<{ width: number; height: number }>;
    mpu: number;
  },
): TilesetDescriptor {
  const {
    projectTo4326,
    projectFrom4326,
    projectTo3857,
    projectFrom3857,
    chunkSizes,
    mpu,
  } = opts;

  if (chunkSizes.length !== meta.levels.length) {
    throw new Error(
      `chunkSizes length (${chunkSizes.length}) must match meta.levels length (${meta.levels.length})`,
    );
  }

  // meta.levels is finest-first; TilesetDescriptor requires coarsest-first
  const reversedLevels = [...meta.levels].reverse();
  const reversedChunks = [...chunkSizes].reverse();

  const levels: TilesetLevel[] = reversedLevels.map((level, i) => {
    const chunk = reversedChunks[i]!;
    return new ZarrTilesetLevel(level, chunk.width, chunk.height, mpu);
  });

  // Compute source CRS bounds from the coarsest level affine applied to array corners
  const coarsestLevel = reversedLevels[0]!;
  const { arrayWidth, arrayHeight, affine: af } = coarsestLevel;
  const corners = [
    affine.apply(af, 0, 0),
    affine.apply(af, arrayWidth, 0),
    affine.apply(af, 0, arrayHeight),
    affine.apply(af, arrayWidth, arrayHeight),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const projectedBounds: Bounds = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];

  return {
    levels,
    projectTo4326,
    projectFrom4326,
    projectTo3857,
    projectFrom3857,
    projectedBounds,
  };
}
