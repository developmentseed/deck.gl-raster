import type * as zarr from "zarrita";

/**
 * Arguments for {@link buildSelection}.
 */
export type BuildSelectionArgs = {
  /** Index into the init_time dim (which forecast run). */
  initTimeIdx: number;
  /** Index into the ensemble_member dim (0 = control run). */
  ensembleMemberIdx: number;
};

/**
 * Build the ZarrLayer `selection` for ECMWF animation: pin init_time and
 * ensemble_member, keep all lead_times (animation axis).
 */
export function buildSelection(
  args: BuildSelectionArgs,
): Record<string, number | zarr.Slice | null> {
  return {
    init_time: args.initTimeIdx,
    lead_time: null, // keep all 85
    ensemble_member: args.ensembleMemberIdx,
  };
}
