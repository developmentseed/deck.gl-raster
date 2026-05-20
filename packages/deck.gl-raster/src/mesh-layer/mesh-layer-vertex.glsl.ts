// Vertex shader for MeshTextureLayer. Override of upstream's
// simple-mesh-layer-vertex.glsl.ts (deck.gl 9.3 @
// 82a028314b8b20275c8f58713e68702407f2eba4):
// https://github.com/visgl/deck.gl/blob/82a028314b8b20275c8f58713e68702407f2eba4/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer-vertex.glsl.ts
//
// Differences from upstream:
//   1. Adds `in vec3 positions64Low;` — per-vertex low part of the
//      fp64-split mesh position. Supplied by MeshTextureLayer via
//      attributeManager.add (non-instanced).
//   2. In the composeModelMatrix branch, passes
//      `positions64Low + instancePositions64Low` (instead of just
//      `instancePositions64Low`) to project_position_to_clipspace, so the
//      shader's existing fp64 path recovers the mesh-vertex precision lost
//      by the float32 attribute pipeline.
//
// The fp64 correction is only valid when the per-instance transforms are
// identity. MeshTextureLayer enforces that by fixing those props and omitting
// them from its public prop type (see MeshTextureLayer's class doc). See
// dev-docs/specs/2026-05-19-high-zoom-precision-design.md and
// dev-docs/coordinate-systems.md.

export default `#version 300 es
#define SHADER_NAME mesh-texture-layer-vs

// Primitive attributes
in vec3 positions;
in vec3 positions64Low;
in vec3 normals;
in vec3 colors;
in vec2 texCoords;

// Instance attributes
in vec3 instancePositions;
in vec3 instancePositions64Low;
in vec4 instanceColors;
in vec3 instancePickingColors;
in vec3 instanceModelMatrixCol0;
in vec3 instanceModelMatrixCol1;
in vec3 instanceModelMatrixCol2;
in vec3 instanceTranslation;

// Outputs to fragment shader
out vec2 vTexCoord;
out vec3 cameraPosition;
out vec3 normals_commonspace;
out vec4 position_commonspace;
out vec4 vColor;

void main(void) {
  geometry.worldPosition = instancePositions;
  geometry.uv = texCoords;
  geometry.pickingColor = instancePickingColors;

  vTexCoord = texCoords;
  cameraPosition = project.cameraPosition;
  vColor = vec4(colors * instanceColors.rgb, instanceColors.a);

  mat3 instanceModelMatrix = mat3(instanceModelMatrixCol0, instanceModelMatrixCol1, instanceModelMatrixCol2);
  vec3 pos = (instanceModelMatrix * positions) * simpleMesh.sizeScale + instanceTranslation;

  if (simpleMesh.composeModelMatrix) {
    DECKGL_FILTER_SIZE(pos, geometry);
    // using instancePositions as world coordinates
    // when using globe mode, this branch does not re-orient the model to align with the surface of the earth
    // call project_normal before setting position to avoid rotation
    normals_commonspace = project_normal(instanceModelMatrix * normals);
    geometry.worldPosition += pos;
    gl_Position = project_position_to_clipspace(pos + instancePositions, positions64Low + instancePositions64Low, vec3(0.0), position_commonspace);
    geometry.position = position_commonspace;
  }
  else {
    pos = project_size(pos);
    DECKGL_FILTER_SIZE(pos, geometry);
    gl_Position = project_position_to_clipspace(instancePositions, instancePositions64Low, pos, position_commonspace);
    geometry.position = position_commonspace;
    normals_commonspace = project_normal(instanceModelMatrix * normals);
  }

  geometry.normal = normals_commonspace;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);

  DECKGL_FILTER_COLOR(vColor, geometry);
}
`;
