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
 * Arguments for {@link findSpatialDimIndices}.
 */
export type FindSpatialDimIndicesArgs = {
  /** Ordered dimension names of the zarr array. */
  dimensionNames: readonly string[];
  /** Declared spatial dim names in [y, x] order. */
  spatialDims: readonly [string, string];
};

/**
 * Find the positions of the declared spatial dims in a zarr array's dimension
 * names. They may sit anywhere and in either order, such as `[band, y, x]`,
 * `[y, x, band]` or `[x, y]`. See the
 * [spatial convention](https://github.com/zarr-conventions/spatial/blob/54d81b7ced0376e63ee10f34db31db7d08dcc28d/README.md?plain=1#L94-L98).
 *
 * @returns The positions of the y and x dims, as `[yIndex, xIndex]`.
 * @throws if a declared spatial dim is missing from the array.
 */
export function findSpatialDimIndices(
  args: FindSpatialDimIndicesArgs,
): [yIndex: number, xIndex: number] {
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

  return [dimensionNames.indexOf(y), dimensionNames.indexOf(x)];
}
