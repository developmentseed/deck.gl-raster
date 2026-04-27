/**
 * A single Ground Control Point: a pixel coordinate paired with a
 * coordinate in the GeoTIFF's GCP CRS.
 *
 * Values come from a `ModelTiepointTag` row of 6 doubles `(I, J, K, X, Y, Z)`,
 * laid out per the GeoTIFF spec.
 */
export interface Gcp {
  /** Pixel column (`I`). */
  pixel: number;
  /** Pixel row (`J`). */
  line: number;
  /** Vertical pixel coordinate (`K`); usually 0 for 2D rasters. */
  k: number;
  /** Easting / longitude in the GCP CRS (`X`). */
  x: number;
  /** Northing / latitude in the GCP CRS (`Y`). */
  y: number;
  /** Elevation in the GCP CRS (`Z`); ignored by 2D fits. */
  z: number;
}

/**
 * Extract GCPs from a `ModelTiepointTag` array.
 *
 * The tag is a flat array of doubles laid out as repeating
 * `(I, J, K, X, Y, Z)` tuples. Returns `null` if the tag is missing, empty,
 * or contains exactly one tuple — a single tie point combined with
 * `ModelPixelScaleTag` is the affine variant, not the GCP variant.
 */
export function parseGcps(modelTiepoint: number[] | null): Gcp[] | null {
  if (modelTiepoint == null || modelTiepoint.length === 0) {
    return null;
  }
  if (modelTiepoint.length % 6 !== 0) {
    throw new Error(
      `ModelTiepointTag length ${modelTiepoint.length} is not a multiple of 6`,
    );
  }
  const count = modelTiepoint.length / 6;
  if (count < 2) {
    return null;
  }
  const gcps: Gcp[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 6;
    gcps[i] = {
      pixel: modelTiepoint[o]!,
      line: modelTiepoint[o + 1]!,
      k: modelTiepoint[o + 2]!,
      x: modelTiepoint[o + 3]!,
      y: modelTiepoint[o + 4]!,
      z: modelTiepoint[o + 5]!,
    };
  }
  return gcps;
}
