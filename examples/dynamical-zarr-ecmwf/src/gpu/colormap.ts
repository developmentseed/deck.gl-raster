import type { Device, Texture } from "@luma.gl/core";

// NOTE: in the future we'll fetch PNG colormaps, such as from matplotlib. We
// could potentially even put them into a single texture atlas and index into
// them with a uniform, if we want to support multiple colormaps.

/**
 * Build a 256-sample RGB lookup table from stop colors, linearly interpolated.
 * Each stop is an [R, G, B] triple in [0, 255]. The first stop anchors t=0,
 * the last anchors t=1, intermediate stops are evenly spaced.
 */
function buildColormapLUT(
  stops: readonly [number, number, number][],
): Uint8Array {
  const n = 256;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const pos = t * (stops.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, stops.length - 1);
    const f = pos - lo;
    const a = stops[lo]!;
    const b = stops[hi]!;
    out[i * 4 + 0] = Math.round(a[0] + (b[0] - a[0]) * f);
    out[i * 4 + 1] = Math.round(a[1] + (b[1] - a[1]) * f);
    out[i * 4 + 2] = Math.round(a[2] + (b[2] - a[2]) * f);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * A diverging blue–white–red palette suitable for temperature in °C.
 */
const BLUE_WHITE_RED: [number, number, number][] = [
  [5, 48, 97],
  [33, 102, 172],
  [67, 147, 195],
  [146, 197, 222],
  [209, 229, 240],
  [247, 247, 247],
  [253, 219, 199],
  [244, 165, 130],
  [214, 96, 77],
  [178, 24, 43],
  [103, 0, 31],
];

/**
 * Create a 256×1 RGBA colormap texture on the given luma.gl device.
 * Caller must create once and share across tiles.
 */
export function createTemperatureColormapTexture(device: Device): Texture {
  const lut = buildColormapLUT(BLUE_WHITE_RED);
  return device.createTexture({
    format: "rgba8unorm",
    width: 256,
    height: 1,
    data: lut,
    sampler: {
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    },
  });
}
