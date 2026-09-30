/**
 * This is a vendored copy of the SimpleMeshLayer's fragment shader:
 * https://github.com/visgl/deck.gl/blob/a15c8cea047993c8a861bf542835c1988f30165c/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer-fragment.glsl.ts
 * under the MIT license.
 *
 * We edited this to:
 *
 * 1. Let render pipeline modules supply the color instead of the hard-coded
 *    texture, because we want to support integer and signed integer textures,
 *    not only normalized unsigned textures. The hard-coded `sampler` stays
 *    declared so it matches the binding SimpleMeshLayer always sets.
 * 2. Remove lighting. Raster pixels are data, so they are written verbatim
 *    (like `BitmapLayer`) and never pass through `lighting_getLightColor`. The
 *    mesh is flat, so lighting could only scale the whole raster by a constant:
 *    a no-op at best, and a tint or darkening under any scene `LightingEffect`
 *    other than deck.gl's default lights.
 */
export default /* glsl */ `#version 300 es
#define SHADER_NAME mesh-texture-layer-fs

precision highp float;

// SimpleMeshLayer always binds its standard texture as \`sampler\` (an empty
// texture when the \`texture\` prop is unset). Declaring it keeps that binding in
// the shader layout.
uniform sampler2D sampler;

in vec2 vTexCoord;
in vec4 vColor;

out vec4 fragColor;

void main(void) {
  geometry.uv = vTexCoord;

  // Start from the SimpleMeshLayer texture, or transparent without one, so
  // color is defined for DECKGL_FILTER_COLOR. Render pipeline modules that
  // sample their own (integer or signed) textures replace it.
  vec4 color = simpleMesh.hasTexture ? texture(sampler, vTexCoord) : vec4(0.0);
  DECKGL_FILTER_COLOR(color, geometry);

  fragColor = vec4(color.rgb, color.a * layer.opacity);
}
`;
