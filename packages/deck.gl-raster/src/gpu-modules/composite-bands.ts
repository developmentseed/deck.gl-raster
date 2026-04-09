import type { ShaderModule } from "@luma.gl/shadertools";

/**
 * Band mapping: which source band goes to which output channel.
 * At least `r` is required; missing channels default to 0.0 (or 1.0 for alpha).
 *
 * @example
 * ```ts
 * const mapping: CompositeBandsMapping = { r: "red", g: "green", b: "blue" };
 * ```
 */
export interface CompositeBandsMapping {
  /** Source band name for the red channel. */
  r: string;
  /** Source band name for the green channel. If omitted, defaults to 0.0. */
  g?: string;
  /** Source band name for the blue channel. If omitted, defaults to 0.0. */
  b?: string;
  /** Source band name for the alpha channel. If omitted, defaults to 1.0. */
  a?: string;
}

/**
 * The concrete shape returned by {@link createCompositeBandsModule}.
 *
 * Narrows the `inject` record to plain strings so callers don't need casts.
 */
export interface CompositeBandsModule
  extends Omit<ShaderModule, "inject" | "getUniforms"> {
  inject: {
    "fs:#decl": string;
    "fs:DECKGL_FILTER_COLOR": string;
  };
  getUniforms: (props: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Create a shader module that samples named band textures with UV transforms
 * and outputs a vec4 color.
 *
 * Each band gets a `sampler2D band_<name>` and `vec4 uvTransform_<name>`
 * uniform. The UV transform is applied before sampling so that textures at
 * different resolutions are correctly aligned.
 *
 * The UV transform encodes `[offsetX, offsetY, scaleX, scaleY]`. The
 * transform is applied as `uv * transform.zw + transform.xy`.
 *
 * @param mapping - Mapping from RGBA output channels to source band names.
 * @returns A luma.gl {@link ShaderModule} ready to use with a deck.gl layer.
 *
 * @see {@link CompositeBandsMapping}
 *
 * @example
 * ```ts
 * const mod = createCompositeBandsModule({ r: "red", g: "green", b: "blue" });
 * // Pass uniforms: band_red, uvTransform_red, band_green, uvTransform_green, …
 * ```
 */
export function createCompositeBandsModule(
  mapping: CompositeBandsMapping,
): CompositeBandsModule {
  const bands = new Set<string>();
  if (mapping.r) bands.add(mapping.r);
  if (mapping.g) bands.add(mapping.g);
  if (mapping.b) bands.add(mapping.b);
  if (mapping.a) bands.add(mapping.a);

  const declarations = [...bands]
    .map(
      (name) =>
        `uniform sampler2D band_${name};\nuniform vec4 uvTransform_${name};`,
    )
    .join("\n");

  const uvHelper = `
vec2 compositeBands_applyUv(vec2 uv, vec4 transform) {
  return uv * transform.zw + transform.xy;
}`;

  /**
   * Returns a GLSL expression that samples a single channel from the named
   * band texture, or a constant literal when the channel is absent.
   *
   * @param channel - Band name, or `undefined` if the channel is not mapped.
   * @param defaultVal - GLSL literal to use when the channel is absent.
   */
  function sampleExpr(channel: string | undefined, defaultVal: string): string {
    if (!channel) return defaultVal;
    return `texture(band_${channel}, compositeBands_applyUv(geometry.uv, uvTransform_${channel})).r`;
  }

  const filterColor = `
  color = vec4(
    ${sampleExpr(mapping.r, "0.0")},
    ${sampleExpr(mapping.g, "0.0")},
    ${sampleExpr(mapping.b, "0.0")},
    ${sampleExpr(mapping.a, "1.0")}
  );`;

  return {
    name: "composite-bands",
    inject: {
      "fs:#decl": `${declarations}\n${uvHelper}`,
      "fs:DECKGL_FILTER_COLOR": filterColor,
    },
    getUniforms: (props: Record<string, unknown>) => {
      const uniforms: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (key.startsWith("band_") || key.startsWith("uvTransform_")) {
          uniforms[key] = value;
        }
      }
      return uniforms;
    },
  };
}
