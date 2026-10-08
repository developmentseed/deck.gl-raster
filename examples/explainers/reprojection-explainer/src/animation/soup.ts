import type { TriangleSoup } from "../layers/triangle-soup.js";

/** RGBA colour with components in 0–1. */
export type UnitColor = [number, number, number, number];

/**
 * Copy per-vertex values out to per-corner values:
 * corner `i` gets the `size` values of vertex `triangles[i]`.
 */
export function expandByCorner(
  triangles: ArrayLike<number>,
  values: ArrayLike<number>,
  size: number,
): Float32Array {
  const out = new Float32Array(triangles.length * size);
  for (let corner = 0; corner < triangles.length; corner++) {
    const vertex = triangles[corner]!;
    for (let k = 0; k < size; k++) {
      out[corner * size + k] = values[vertex * size + k]!;
    }
  }
  return out;
}

/** Barycentric coordinates for `triangleCount` de-indexed triangles. */
export function barycentricsFor(triangleCount: number): Float32Array {
  const out = new Float32Array(triangleCount * 9);
  for (let t = 0; t < triangleCount; t++) {
    out[9 * t] = 1;
    out[9 * t + 4] = 1;
    out[9 * t + 8] = 1;
  }
  return out;
}

/**
 * Per-corner tints for `triangleCount` triangles. Triangle `t` gets
 * `tintOf(t)` on all three corners, or transparent when it returns null.
 */
export function tintsFor(
  triangleCount: number,
  tintOf?: (triangle: number) => UnitColor | null,
): Float32Array {
  const out = new Float32Array(triangleCount * 12);
  if (!tintOf) {
    return out;
  }
  for (let t = 0; t < triangleCount; t++) {
    const tint = tintOf(t);
    if (!tint) {
      continue;
    }
    for (let k = 0; k < 3; k++) {
      out.set(tint, 12 * t + 4 * k);
    }
  }
  return out;
}

/** Build a triangle soup from indexed triangles and shared-vertex data. */
export function createSoup(options: {
  /** Vertex ids, 3 per triangle. */
  triangles: ArrayLike<number>;
  /** Slide positions per vertex, 2 per vertex. */
  positions: ArrayLike<number>;
  /** Texture coordinates per vertex, 2 per vertex. */
  uvs: ArrayLike<number>;
  /** Optional tint per triangle. */
  tintOf?: (triangle: number) => UnitColor | null;
}): TriangleSoup {
  const { triangles, positions, uvs, tintOf } = options;
  const triangleCount = triangles.length / 3;
  return {
    vertexCount: triangles.length,
    positions: expandByCorner(triangles, positions, 2),
    texCoords: expandByCorner(triangles, uvs, 2),
    barycentrics: barycentricsFor(triangleCount),
    tints: tintsFor(triangleCount, tintOf),
  };
}

/** Centroid x of each triangle, from per-corner positions (2 per corner). */
export function centroidsX(cornerPositions: ArrayLike<number>): Float32Array {
  const triangleCount = cornerPositions.length / 6;
  const out = new Float32Array(triangleCount);
  for (let t = 0; t < triangleCount; t++) {
    out[t] =
      (cornerPositions[6 * t]! +
        cornerPositions[6 * t + 2]! +
        cornerPositions[6 * t + 4]!) /
      3;
  }
  return out;
}
