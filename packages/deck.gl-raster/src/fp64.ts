/**
 * Split a Float64Array into the high + low Float32 component arrays used for
 * fp64-emulated positions on the GPU.
 *
 * For each element `v`, the high part is `Math.fround(v)` (the nearest
 * float32) and the low part is the residual `v - Math.fround(v)` (also exactly
 * representable as a float32, since `|residual| <= ulp_f32(v) / 2`). Summed in
 * the shader, the pair carries float64-equivalent precision — deck.gl's
 * projection shader takes both via its `position64Low` parameter and adds
 * `modelMatrix * low` back after the main computation.
 *
 * @returns `[low, high]` — both `Float32Array`s the same length as `values`.
 *
 * See `dev-docs/coordinate-systems.md` and
 * `dev-docs/specs/2026-05-19-high-zoom-precision-design.md`.
 */
export function splitFloat64Array(
  values: Float64Array,
): [low: Float32Array, high: Float32Array] {
  const low = new Float32Array(values.length);
  const high = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    const hi = Math.fround(v);
    high[i] = hi;
    low[i] = v - hi;
  }
  return [low, high];
}
