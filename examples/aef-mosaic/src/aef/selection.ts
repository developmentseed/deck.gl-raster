import type * as zarr from "zarrita";

/**
 * Arguments for {@link buildSelection}.
 */
export type BuildSelectionArgs = {
  /** Index into the `time` dim (0 = 2017, 8 = 2025). */
  yearIdx: number;
};

/**
 * Build the ZarrLayer `selection` prop for AEF: pin `time` to the chosen
 * year, keep all 64 bands (the render pipeline samples three of them on the
 * GPU per fragment).
 */
export function buildSelection(
  args: BuildSelectionArgs,
): Record<string, number | zarr.Slice | null> {
  return {
    time: args.yearIdx,
    band: null,
  };
}
