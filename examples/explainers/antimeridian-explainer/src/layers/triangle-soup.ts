/**
 * De-indexed triangles: every triangle has its own three vertices, so
 * triangles can move independently of their neighbours.
 */
export type TriangleSoup = {
  /** Number of vertices (3 per triangle). */
  vertexCount: number;
  /** Slide-space x, y per vertex. */
  positions: Float32Array;
  /** Texture coordinate u, v per vertex (v = 0 is the image's top row). */
  texCoords: Float32Array;
  /** Barycentric coordinate per vertex: (1,0,0), (0,1,0) or (0,0,1). */
  barycentrics: Float32Array;
  /** RGBA tint per vertex (0–1), blended over the texture colour by its alpha. */
  tints: Float32Array;
};
