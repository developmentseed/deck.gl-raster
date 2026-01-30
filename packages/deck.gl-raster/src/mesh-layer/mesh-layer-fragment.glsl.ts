/**
 * This is a vendored copy of the SimpleMeshLayer's fragment shader:
 * https://github.com/visgl/deck.gl/blob/a15c8cea047993c8a861bf542835c1988f30165c/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer-fragment.glsl.ts
 * under the MIT license.
 *
 * We edited this to remove the hard-coded texture uniform because we want to
 * support integer and signed integer textures, not only normalized unsigned
 * textures.
 */
export default /* glsl */ `#version 300 es
#define SHADER_NAME simple-mesh-layer-fs

precision highp float;

in vec2 vTexCoord;
in vec3 cameraPosition;
in vec3 normals_commonspace;
in vec4 position_commonspace;
in vec4 vColor;

out vec4 fragColor;

void main(void) {
  // geometry.uv is set by shader modules (PassthroughUV or Reproject4326)
  // at fs:#main-start injection point, before this code runs.

  vec3 normal;
  if (simpleMesh.flatShading) {

  normal = normalize(cross(dFdx(position_commonspace.xyz), dFdy(position_commonspace.xyz)));
  } else {
    normal = normals_commonspace;
  }

  // We initialize color here before passing into DECKGL_FILTER_COLOR
  vec4 color;
  DECKGL_FILTER_COLOR(color, geometry);

  vec3 lightColor = lighting_getLightColor(color.rgb, cameraPosition, position_commonspace.xyz, normal);
  fragColor = vec4(lightColor, color.a * layer.opacity);
}
`;
