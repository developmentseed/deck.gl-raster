import { RasterTypeKey } from "@cogeotiff/core";
import type { Affine } from "@developmentseed/affine";
import { apply, compose, invert, translation } from "@developmentseed/affine";

export function createTransform({
  modelTiepoint,
  modelPixelScale,
  modelTransformation,
  rasterType,
}: {
  modelTiepoint: number[] | null;
  modelPixelScale: number[] | null;
  modelTransformation: number[] | null;
  rasterType: RasterTypeKey | null;
}): Affine {
  let transform: Affine;
  if (modelTiepoint && modelPixelScale) {
    transform = createFromModelTiepointAndPixelScale(
      modelTiepoint,
      modelPixelScale,
    );
  } else if (modelTransformation) {
    transform = createFromModelTransformation(modelTransformation);
  } else {
    throw new Error("The image does not have an affine transformation.");
  }

  // Offset transform by half pixel for point-interpreted rasters.
  if (rasterType === RasterTypeKey.PixelIsPoint) {
    transform = compose(transform, translation(-0.5, -0.5));
  }

  return transform;
}

function createFromModelTiepointAndPixelScale(
  modelTiepoint: number[],
  modelPixelScale: number[],
): Affine {
  const xOrigin = modelTiepoint[3]!;
  const yOrigin = modelTiepoint[4]!;
  const xResolution = modelPixelScale[0]!;
  const yResolution = -modelPixelScale[1]!;

  return [xResolution, 0, xOrigin, 0, yResolution, yOrigin];
}

function createFromModelTransformation(modelTransformation: number[]): Affine {
  // ModelTransformation is a 4x4 matrix in row-major order
  // [0  1  2  3 ]   [a  b  0  c]
  // [4  5  6  7 ] = [d  e  0  f]
  // [8  9  10 11]   [0  0  1  0]
  // [12 13 14 15]   [0  0  0  1]
  const xOrigin = modelTransformation[3]!;
  const yOrigin = modelTransformation[7]!;
  const rowRotation = modelTransformation[1]!;
  const colRotation = modelTransformation[4]!;
  const xResolution = modelTransformation[0]!;
  const yResolution = modelTransformation[5]!;

  return [xResolution, rowRotation, xOrigin, colRotation, yResolution, yOrigin];
}

/**
 * Interface for objects that have an affine transform.
 */
export interface HasTransform {
  /** The affine transform. */
  readonly transform: Affine;
}

/**
 * Get the (row, col) pixel index containing the geographic coordinate (x, y).
 *
 * @param x          x coordinate in the CRS.
 * @param y          y coordinate in the CRS.
 * @param op         Rounding function applied to fractional pixel indices.
 *                   Defaults to Math.floor.
 * @returns          [row, col] pixel indices.
 */
export function index(
  self: HasTransform,
  x: number,
  y: number,
  op: (n: number) => number = Math.floor,
): [number, number] {
  const inv = invert(self.transform);
  const [col, row] = apply(inv, x, y);
  return [op(row), op(col)];
}

/**
 * Get the geographic (x, y) coordinate of the pixel at (row, col).
 *
 * @param row        Pixel row.
 * @param col        Pixel column.
 * @param offset     Which part of the pixel to return.  Defaults to "center".
 * @returns          [x, y] in the CRS.
 */
export function xy(
  self: HasTransform,
  row: number,
  col: number,
  offset: "center" | "ul" | "ur" | "ll" | "lr" = "center",
): [number, number] {
  let c: number;
  let r: number;

  switch (offset) {
    case "center":
      c = col + 0.5;
      r = row + 0.5;
      break;
    case "ul":
      c = col;
      r = row;
      break;
    case "ur":
      c = col + 1;
      r = row;
      break;
    case "ll":
      c = col;
      r = row + 1;
      break;
    case "lr":
      c = col + 1;
      r = row + 1;
      break;
  }

  return apply(self.transform, c, r);
}
