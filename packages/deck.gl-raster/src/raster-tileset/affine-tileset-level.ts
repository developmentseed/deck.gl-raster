import type { Affine } from "@developmentseed/affine";
import * as affine from "@developmentseed/affine";
import type { TilesetLevel } from "./tileset-interface.js";
import type { Corners } from "./types.js";

/**
 * Constructor options for {@link AffineTilesetLevel}.
 */
export interface AffineTilesetLevelOptions {
  /** Pixel → CRS affine transform for this resolution level. */
  affine: Affine;
  /** Full level width, in pixels. */
  arrayWidth: number;
  /** Full level height, in pixels. */
  arrayHeight: number;
  /** Tile width, in pixels. */
  tileWidth: number;
  /** Tile height, in pixels. */
  tileHeight: number;
  /** Meters per CRS unit (1 for metric CRSes, ≈111000 for WGS84). */
  mpu: number;
}

/**
 * A {@link TilesetLevel} described by a single affine transform plus tile and
 * array sizes.
 *
 * This handles axis-aligned, rotated, skewed, and non-square-pixel grids
 * uniformly. Sources that fit this shape (tiled GeoTIFF overviews, GeoZarr
 * multiscales) can construct one of these per resolution level instead of
 * implementing {@link TilesetLevel} manually.
 */
export class AffineTilesetLevel implements TilesetLevel {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly matrixWidth: number;
  readonly matrixHeight: number;
  readonly metersPerPixel: number;

  private readonly _affine: Affine;
  private readonly _invAffine: Affine;

  constructor(options: AffineTilesetLevelOptions) {
    this._affine = options.affine;
    this._invAffine = affine.invert(options.affine);
    this.tileWidth = options.tileWidth;
    this.tileHeight = options.tileHeight;
    this.matrixWidth = Math.ceil(options.arrayWidth / options.tileWidth);
    this.matrixHeight = Math.ceil(options.arrayHeight / options.tileHeight);

    // Geometric mean of the two pixel-edge scales handles non-square pixels.
    const a = affine.a(options.affine);
    const e = affine.e(options.affine);
    this.metersPerPixel = Math.sqrt(Math.abs(a * e)) * options.mpu;
  }

  projectedTileCorners(col: number, row: number): Corners {
    const tw = this.tileWidth;
    const th = this.tileHeight;
    const af = this._affine;

    return {
      topLeft: affine.apply(af, col * tw, row * th),
      topRight: affine.apply(af, (col + 1) * tw, row * th),
      bottomLeft: affine.apply(af, col * tw, (row + 1) * th),
      bottomRight: affine.apply(af, (col + 1) * tw, (row + 1) * th),
    };
  }

  tileTransform(
    col: number,
    row: number,
  ): {
    forwardTransform: (x: number, y: number) => [number, number];
    inverseTransform: (x: number, y: number) => [number, number];
  } {
    const tileOffset = affine.translation(
      col * this.tileWidth,
      row * this.tileHeight,
    );
    const tileAffine = affine.compose(this._affine, tileOffset);
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
    // then take the bbox in pixel space (handles rotation correctly).
    const inv = this._invAffine;
    const pixelCorners = [
      affine.apply(inv, projectedMinX, projectedMinY),
      affine.apply(inv, projectedMaxX, projectedMinY),
      affine.apply(inv, projectedMinX, projectedMaxY),
      affine.apply(inv, projectedMaxX, projectedMaxY),
    ];

    const xs = pixelCorners.map(([px]) => px);
    const ys = pixelCorners.map(([, py]) => py);

    const pixMinX = Math.min(...xs);
    const pixMaxX = Math.max(...xs);
    const pixMinY = Math.min(...ys);
    const pixMaxY = Math.max(...ys);

    const tw = this.tileWidth;
    const th = this.tileHeight;
    const maxColIdx = this.matrixWidth - 1;
    const maxRowIdx = this.matrixHeight - 1;

    const minCol = Math.max(0, Math.min(maxColIdx, Math.floor(pixMinX / tw)));
    const maxCol = Math.max(0, Math.min(maxColIdx, Math.floor(pixMaxX / tw)));
    const minRow = Math.max(0, Math.min(maxRowIdx, Math.floor(pixMinY / th)));
    const maxRow = Math.max(0, Math.min(maxRowIdx, Math.floor(pixMaxY / th)));

    return { minCol, maxCol, minRow, maxRow };
  }
}
