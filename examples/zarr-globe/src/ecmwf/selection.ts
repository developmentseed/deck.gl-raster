import type * as zarr from "zarrita";

/**
 * Arguments for {@link buildSelection}.
 */
export type BuildSelectionArgs = {
  /** Index into the init_time dim (which forecast run). */
  initTimeIdx: number;
};

/**
 * Build the ZarrLayer `selection` for ECMWF animation: pin init_time, keep
 * all lead_times (animation axis).
 */
export function buildSelection(
  args: BuildSelectionArgs,
): Record<string, number | zarr.Slice | null> {
  return {
    init_time: args.initTimeIdx,
    lead_time: null, // keep all 61
  };
}
