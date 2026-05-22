// Vertex shader for MeshTextureLayer. Override of upstream's
// simple-mesh-layer-vertex.glsl.ts (deck.gl 9.3 @
// 09af8de8d18a9cb9a31d064cae8f9e7239df7f53):
// https://github.com/visgl/deck.gl/blob/09af8de8d18a9cb9a31d064cae8f9e7239df7f53/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer-vertex.glsl.ts
//
// Differences from upstream:
//   1. Adds `in vec3 positions64Low;` — per-vertex low part of the
//      fp64-split mesh position. Supplied by MeshTextureLayer via
//      attributeManager.add (non-instanced).
//   2. Passes `positions64Low + instancePositions64Low` to
//      project_position_to_clipspace, so the shader's fp64 path recovers the
//      mesh-vertex precision lost by the float32 attribute pipeline.
//   3. Collapses upstream's `composeModelMatrix` branch to a single
//      direct-projection path. MeshTextureLayer always draws ONE
//      non-instanced, identity-transform mesh anchored at the origin
//      (instancePositions = [0,0,0], identity instanceModelMatrix, sizeScale =
//      1), so the instanced / meters-offset (upstream's `else`) branch never
//      applied. Projecting `pos` directly is correct for BOTH cartesian
//      (common-space mesh, Web Mercator) and lnglat (degrees, GlobeView):
//      project_position_to_clipspace handles each coordinate system. This is
//      what makes GlobeView render correctly — upstream's `else` branch ran
//      project_size(pos) on lng/lat degrees, which is meaningless. See
//      dev-docs/specs/2026-05-21-globe-view-design.md.
//
// The fp64 correction is only valid when the per-instance transforms are
// identity. MeshTextureLayer enforces that by fixing those props and omitting
// them from its public prop type (see MeshTextureLayer's class doc). See
// dev-docs/specs/2026-05-19-high-zoom-precision-design.md and
// dev-docs/coordinate-systems.md.

export default /* glsl */ `#version 300 es
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

  DECKGL_FILTER_SIZE(pos, geometry);
  // Call project_normal before project_position so the normal isn't affected by
  // a position offset (unused for unlit raster, kept for parity with upstream).
  normals_commonspace = project_normal(instanceModelMatrix * normals);
  geometry.worldPosition += pos;

  // No composeModelMatrix branch: that flag only matters when placing an
  // instanced model offset from an anchor. MeshTextureLayer always draws one
  // mesh at instancePositions = [0,0,0] with identity transforms, so we project
  // the mesh vertex directly (with its fp64 low part). This is correct for both
  // cartesian (common-space, Web Mercator) and lnglat (degrees, GlobeView) —
  // project_position_to_clipspace handles each coordinate system.
  gl_Position = project_position_to_clipspace(pos + instancePositions, positions64Low + instancePositions64Low, vec3(0.0), position_commonspace);
  geometry.position = position_commonspace;

  geometry.normal = normals_commonspace;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);

  DECKGL_FILTER_COLOR(vColor, geometry);
}
`;
