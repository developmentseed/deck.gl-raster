import type * as zarr from "zarrita";

/**
 * Arguments for {@link validateSelection}.
 */
export type ValidateSelectionArgs = {
  /** Ordered dimension names of the zarr array. */
  dimensionNames: readonly string[];
  /** Names of the spatial dims (subset of dimensionNames). */
  spatialDims: readonly [string, string];
  /** User-provided selection map. */
  selection: Record<string, number | zarr.Slice | null>;
};

/**
 * Validate that `selection` has exactly one entry per non-spatial named dim
 * of the zarr array. No silent defaults.
 *
 * @throws if selection is missing non-spatial dims, includes a spatial dim,
 *         or includes unknown dims.
 */
export function validateSelection(args: ValidateSelectionArgs): void {
  const { dimensionNames, spatialDims, selection } = args;
  const nonSpatial = dimensionNames.filter((d) => !spatialDims.includes(d));
  const spatialSet = new Set(spatialDims);
  const dimSet = new Set(dimensionNames);

  for (const name of nonSpatial) {
    if (!(name in selection)) {
      throw new Error(
        `ZarrLayer selection is missing non-spatial dim "${name}". ` +
          `All non-spatial dims must be explicitly pinned or sliced.`,
      );
    }
  }

  for (const key of Object.keys(selection)) {
    if (spatialSet.has(key)) {
      throw new Error(
        `ZarrLayer selection must not include spatial dim "${key}". ` +
          `Spatial dims are determined by the tiler.`,
      );
    }
    if (!dimSet.has(key)) {
      throw new Error(
        `ZarrLayer selection includes unknown dim "${key}". ` +
          `Array dims are: ${dimensionNames.join(", ")}.`,
      );
    }
  }
}

/**
 * Arguments for {@link validateSpatialDimOrder}.
 */
export type ValidateSpatialDimOrderArgs = {
  /** Ordered dimension names of the zarr array. */
  dimensionNames: readonly string[];
  /** Declared spatial dim names in [y, x] order. */
  spatialDims: readonly [string, string];
};

/**
 * Validate that the zarr array's dimension names place the spatial dims as
 * the last two entries, in [y, x] order. Transpose is not implemented yet —
 * arrays with a different layout are rejected.
 *
 * @throws if the declared spatial dims are missing from the array, not the
 *         last two positions, or in swapped order.
 */
export function validateSpatialDimOrder(
  args: ValidateSpatialDimOrderArgs,
): void {
  const { dimensionNames, spatialDims } = args;
  const [y, x] = spatialDims;

  if (!dimensionNames.includes(y)) {
    throw new Error(
      `Declared spatial dim "${y}" is not present in zarr array dims ` +
        `[${dimensionNames.join(", ")}].`,
    );
  }
  if (!dimensionNames.includes(x)) {
    throw new Error(
      `Declared spatial dim "${x}" is not present in zarr array dims ` +
        `[${dimensionNames.join(", ")}].`,
    );
  }

  const n = dimensionNames.length;
  const yPos = dimensionNames[n - 2];
  const xPos = dimensionNames[n - 1];

  if (yPos !== y || xPos !== x) {
    if (yPos === x && xPos === y) {
      throw new Error(
        `Spatial dim order is swapped: expected ["${y}", "${x}"] at the ` +
          `last two positions, got ["${yPos}", "${xPos}"]. Transpose is ` +
          `not implemented yet.`,
      );
    }
    throw new Error(
      `Spatial dims must be the last two entries in dimension_names: ` +
        `expected ["${y}", "${x}"] at positions [${n - 2}, ${n - 1}], got ` +
        `["${yPos}", "${xPos}"]. Transpose is not implemented yet.`,
    );
  }
}
