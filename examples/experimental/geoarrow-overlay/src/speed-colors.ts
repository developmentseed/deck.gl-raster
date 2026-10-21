/** Matplotlib's "plasma" colormap, sampled at nine evenly spaced stops. */
const PLASMA_STOPS: [number, number, number][] = [
  [13, 8, 135],
  [76, 2, 161],
  [126, 3, 168],
  [169, 35, 149],
  [204, 71, 120],
  [229, 107, 93],
  [248, 149, 64],
  [253, 197, 39],
  [240, 249, 33],
];

/**
 * Download speeds (Mbps) at the two ends of the colormap. Colors use a log
 * scale between them; speeds outside are clamped to the end colors.
 */
export const SPEED_COLOR_DOMAIN_MBPS: [number, number] = [3, 600];

const LUT_SIZE = 256;
const LOG_MIN = Math.log10(SPEED_COLOR_DOMAIN_MBPS[0]);
const LOG_MAX = Math.log10(SPEED_COLOR_DOMAIN_MBPS[1]);

/** RGB lookup table with {@link LUT_SIZE} entries, interpolated from the stops. */
const LUT: Uint8Array = buildLut();

function buildLut(): Uint8Array {
  const lut = new Uint8Array(LUT_SIZE * 3);
  const segments = PLASMA_STOPS.length - 1;
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = (i / (LUT_SIZE - 1)) * segments;
    const lower = Math.min(Math.floor(t), segments - 1);
    const frac = t - lower;
    const a = PLASMA_STOPS[lower];
    const b = PLASMA_STOPS[lower + 1];
    for (let c = 0; c < 3; c++) {
      lut[i * 3 + c] = Math.round(a[c] + (b[c] - a[c]) * frac);
    }
  }
  return lut;
}

/**
 * Color each download speed with the plasma colormap on a log scale.
 *
 * @param mbps Download speed per point, in megabits per second.
 * @param alpha Alpha (0-255) for every point.
 * @returns Interleaved RGBA, four bytes per point.
 */
export function speedColors(mbps: Float32Array, alpha: number): Uint8Array {
  const rgba = new Uint8Array(mbps.length * 4);
  const scale = (LUT_SIZE - 1) / (LOG_MAX - LOG_MIN);
  for (let i = 0; i < mbps.length; i++) {
    const t = (Math.log10(Math.max(mbps[i], 1e-3)) - LOG_MIN) * scale;
    const index = Math.min(LUT_SIZE - 1, Math.max(0, Math.round(t))) * 3;
    rgba[i * 4] = LUT[index];
    rgba[i * 4 + 1] = LUT[index + 1];
    rgba[i * 4 + 2] = LUT[index + 2];
    rgba[i * 4 + 3] = alpha;
  }
  return rgba;
}

/** CSS `linear-gradient` matching the colormap, for the legend. */
export const SPEED_GRADIENT_CSS = `linear-gradient(to right, ${PLASMA_STOPS.map(
  ([r, g, b]) => `rgb(${r}, ${g}, ${b})`,
).join(", ")})`;
