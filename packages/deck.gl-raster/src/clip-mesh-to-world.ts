/** A 2D triangle mesh: flat `[x, y, ...]` positions, `[u, v, ...]` uvs. */
export interface Mesh2D {
  positions: number[];
  uvs: number[];
  triangles: number[];
}

/** One clipped-polygon vertex: position + uv. */
type Vertex = [x: number, y: number, u: number, v: number];

/**
 * Clip a mesh whose x was unwrapped across a periodic seam (see
 * `RasterReprojector`'s `wrapX`) at every multiple of `period`, and shift each
 * part back into `[0, period]`.
 *
 * Each world boundary is the mesh's real discontinuity, so this is exact for
 * any seam shape. New vertices on a boundary get uv by linear interpolation
 * along the cut edge — the same piecewise-linear texture mapping the unclipped
 * triangle had. A mesh that already lies in one copy comes back unchanged
 * apart from that copy's shift.
 */
export function clipMeshToWorld(mesh: Mesh2D, period: number): Mesh2D {
  const { positions, uvs, triangles } = mesh;
  const out: Mesh2D = { positions: [], uvs: [], triangles: [] };
  // Unclipped vertices are reused per (vertex, copy) to keep the mesh indexed.
  const shared = new Map<number, number>();

  const pushVertex = ([x, y, u, v]: Vertex, shift: number): number => {
    out.positions.push(x - shift, y);
    out.uvs.push(u, v);
    return out.positions.length / 2 - 1;
  };
  const sharedVertex = (i: number, k: number): number => {
    // Fold the copy into the key; meshes never span anywhere near 2^20 copies.
    const key = i * 2048 + (k + 1024);
    let index = shared.get(key);
    if (index === undefined) {
      index = pushVertex(vertexAt(i), k * period);
      shared.set(key, index);
    }
    return index;
  };
  const vertexAt = (i: number): Vertex => [
    positions[2 * i]!,
    positions[2 * i + 1]!,
    uvs[2 * i]!,
    uvs[2 * i + 1]!,
  ];

  for (let t = 0; t < triangles.length; t += 3) {
    const idx = [triangles[t]!, triangles[t + 1]!, triangles[t + 2]!];
    const xs = idx.map((i) => positions[2 * i]!);
    const kMin = Math.floor(Math.min(...xs) / period);
    // A triangle that only touches its copy's upper boundary isn't crossing.
    const kMax = Math.max(kMin, Math.ceil(Math.max(...xs) / period) - 1);

    if (kMin === kMax) {
      for (const i of idx) {
        out.triangles.push(sharedVertex(i, kMin));
      }
      continue;
    }

    for (let k = kMin; k <= kMax; k++) {
      let polygon = idx.map(vertexAt);
      polygon = clipX(polygon, k * period, 1);
      polygon = clipX(polygon, (k + 1) * period, -1);
      if (polygon.length < 3) {
        continue;
      }
      const ring = polygon.map((p) => pushVertex(p, k * period));
      // Clipping a triangle by half-planes leaves a convex polygon: fan it.
      for (let j = 1; j < ring.length - 1; j++) {
        out.triangles.push(ring[0]!, ring[j]!, ring[j + 1]!);
      }
    }
  }

  return out;
}

/**
 * Sutherland–Hodgman against one vertical line: keep `x >= edge` when
 * `side = 1`, `x <= edge` when `side = -1`.
 */
function clipX(polygon: Vertex[], edge: number, side: 1 | -1): Vertex[] {
  const inside = (p: Vertex) => side * (p[0] - edge) >= 0;
  const result: Vertex[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    if (inside(a)) {
      result.push(a);
    }
    if (inside(a) !== inside(b)) {
      const s = (edge - a[0]) / (b[0] - a[0]);
      result.push([
        edge,
        a[1] + s * (b[1] - a[1]),
        a[2] + s * (b[2] - a[2]),
        a[3] + s * (b[3] - a[3]),
      ]);
    }
  }
  return result;
}
