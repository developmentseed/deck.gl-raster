/**
 * Hardcoded GeoZarr-compliant attrs for the ECMWF IFS ENS 15-day 0.25°
 * dataset hosted by Dynamical.org. The source store is not GeoZarr-compliant,
 * so we inject a synthetic attrs object that parseGeoZarrMetadata accepts.
 *
 * Grid: 721 lat (90 → -90 step -0.25) × 1440 lon (-180 → 179.75 step 0.25).
 * CRS: WMO spherical ellipsoid in the source; we render as EPSG:4326.
 */
export const ECMWF_GEOZARR_ATTRS = {
  "spatial:dimensions": ["latitude", "longitude"],
  // Affine [a, b, c, d, e, f] in this repo's convention (see @developmentseed/affine):
  //   x_out = a*col + b*row + c
  //   y_out = d*col + e*row + f
  // For ECMWF: top-left corner at (lon=-180, lat=90); step (0.25°, -0.25°).
  //   x_out = 0.25*col +  0*row + (-180)  → [-180, 180]
  //   y_out =   0*col + (-0.25)*row + 90  → [90, -90.25]
  "spatial:transform": [0.25, 0, -180, 0, -0.25, 90],
  "spatial:shape": [721, 1440], // [height, width]
  "proj:code": "EPSG:4326",
} as const;

/**
 * Names of the non-spatial named dims in the ECMWF variable arrays, in order.
 */
export const ECMWF_NON_SPATIAL_DIMS = [
  "init_time",
  "lead_time",
  "ensemble_member",
] as const;

/**
 * Lead-time schedule in hours from init_time. 3-hourly from 0 to 144h, then
 * 6-hourly to 360h. 85 entries total, matches dim length.
 */
export const ECMWF_LEAD_TIME_HOURS: readonly number[] = (() => {
  const hours: number[] = [];
  for (let h = 0; h <= 144; h += 3) hours.push(h);
  for (let h = 150; h <= 360; h += 6) hours.push(h);
  return hours;
})();

/**
 * Number of lead_time frames (= animation length).
 */
export const ECMWF_LEAD_TIME_COUNT = ECMWF_LEAD_TIME_HOURS.length;

/**
 * Step (in hours) between frame `i` and frame `i + 1`. The last entry
 * repeats the final known step so the array has the same length as
 * {@link ECMWF_LEAD_TIME_HOURS}, and wrap-around (returning from frame
 * count−1 back to frame 0) uses it too.
 */
export const ECMWF_LEAD_TIME_STEP_HOURS: readonly number[] = (() => {
  const steps: number[] = [];
  for (let i = 0; i < ECMWF_LEAD_TIME_HOURS.length - 1; i++) {
    steps.push(ECMWF_LEAD_TIME_HOURS[i + 1]! - ECMWF_LEAD_TIME_HOURS[i]!);
  }
  steps.push(steps[steps.length - 1] ?? 3);
  return steps;
})();
