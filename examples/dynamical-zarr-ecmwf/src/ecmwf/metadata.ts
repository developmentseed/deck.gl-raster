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
  // [a, b, c, d, e, f] where px = a + b*col + c*row, py = d + e*col + f*row
  // For ECMWF: top-left corner at (lon=-180, lat=90), step (0.25, -0.25).
  "spatial:transform": [-180, 0.25, 0, 90, 0, -0.25],
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
