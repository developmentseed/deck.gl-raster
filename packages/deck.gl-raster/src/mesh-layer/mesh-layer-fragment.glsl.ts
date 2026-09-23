/**
 * This is a vendored copy of the SimpleMeshLayer's fragment shader:
 * https://github.com/visgl/deck.gl/blob/a15c8cea047993c8a861bf542835c1988f30165c/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer-fragment.glsl.ts
 * under the MIT license.
 *
 * We edited this to:
 *
 * 1. Remove the hard-coded texture uniform because we want to support integer
 *    and signed integer textures, not only normalized unsigned textures.
 * 2. Remove lighting. Raster pixels are data, so they are written verbatim
 *    (like `BitmapLayer`) and never pass through `lighting_getLightColor`. The
 *    mesh is flat, so lighting could only scale the whole raster by a constant:
 *    a no-op at best, and a tint or darkening under any scene `LightingEffect`
 *    other than deck.gl's default lights.
 */
export default /* glsl */ `#version 300 es
#define SHADER_NAME mesh-texture-layer-fs

precision highp float;

in vec2 vTexCoord;
in vec4 vColor;

out vec4 fragColor;

void main(void) {
  geometry.uv = vTexCoord;

  // We initialize color here before passing into DECKGL_FILTER_COLOR
  vec4 color;
  DECKGL_FILTER_COLOR(color, geometry);

  fragColor = vec4(color.rgb, color.a * layer.opacity);
}
`;
