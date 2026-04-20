import type { Device, Texture } from "@luma.gl/core";

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
 * Diverging blue–white–red palette (RdBu_r style).
 * t=0 → deep blue (cold anomaly), t=0.5 → white (no anomaly), t=1 → deep red (warm anomaly).
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

export function createAnomalyColormapTexture(device: Device): Texture {
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
