/**
 * Hardcoded GeoZarr-compliant attrs for the ECMWF AIFS Single 15-day 0.25°
 * forecast hosted by Dynamical.org. The source store is not GeoZarr-compliant,
 * so we inject a synthetic attrs object that parseGeoZarrMetadata accepts.
 *
 * Grid: 721 lat (90 -> -90 step -0.25) x 1440 lon (-180 -> 179.75 step 0.25).
 * CRS: WMO spherical ellipsoid in the source; we render as EPSG:4326.
 */
export const ECMWF_GEOZARR_ATTRS = {
  "spatial:dimensions": ["latitude", "longitude"],
  // Affine [a, b, c, d, e, f] in this repo's convention (see @developmentseed/affine):
  //   x_out = a*col + b*row + c
  //   y_out = d*col + e*row + f
  // For ECMWF: top-left corner at (lon=-180, lat=90); step (0.25°, -0.25°).
  //   x_out = 0.25*col +  0*row + (-180)  -> [-180, 180]
  //   y_out =   0*col + (-0.25)*row + 90  -> [90, -90.25]
  "spatial:transform": [0.25, 0, -180, 0, -0.25, 90],
  "spatial:shape": [721, 1440], // [height, width]
  "proj:code": "EPSG:4326",
} as const;

/**
 * Names of the non-spatial named dims in the ECMWF variable arrays, in order.
 */
export const ECMWF_NON_SPATIAL_DIMS = ["init_time", "lead_time"] as const;

/**
 * The first forecast init_time in the dataset. A run starts every 6 hours, so
 * `init_time[i]` corresponds to `ECMWF_INIT_TIME_ORIGIN + 6 * i hours`.
 */
export const ECMWF_INIT_TIME_ORIGIN = new Date("2024-04-01T00:00:00Z");

const MS_PER_RUN = 6 * 60 * 60 * 1000;

/** Convert an `init_time` array index to its UTC Date. */
export function dateFromInitTimeIdx(idx: number): Date {
  return new Date(ECMWF_INIT_TIME_ORIGIN.getTime() + idx * MS_PER_RUN);
}

/**
 * Convert a UTC Date to the matching `init_time` index, clamped into
 * `[0, maxIdx]`. UTC midnight maps to that day's 00 UTC run.
 */
export function initTimeIdxFromDate(date: Date, maxIdx: number): number {
  const runDiff = Math.round(
    (date.getTime() - ECMWF_INIT_TIME_ORIGIN.getTime()) / MS_PER_RUN,
  );
  return Math.max(0, Math.min(maxIdx, runDiff));
}

/** Format a Date as `YYYY-MM-DD` (UTC) for an `<input type="date">`. */
export function isoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Lead-time schedule in hours from init_time: 6-hourly from 0 to 360 h. 61
 * entries, matches dim length.
 */
export const ECMWF_LEAD_TIME_HOURS: readonly number[] = Array.from(
  { length: 61 },
  (_, i) => i * 6,
);

/**
 * Number of lead_time frames (= animation length).
 */
export const ECMWF_LEAD_TIME_COUNT = ECMWF_LEAD_TIME_HOURS.length;
