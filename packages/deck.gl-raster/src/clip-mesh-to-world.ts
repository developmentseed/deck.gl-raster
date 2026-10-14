/**
 * A 2D triangle mesh: flat `[x, y, …]` positions, flat `[u, v, …]` texture
 * coordinates, and vertex indices, 3 per triangle.
 */
export type Mesh2D = {
  positions: number[];
  uvs: number[];
  triangles: number[];
};

/** A vertex of a clipped polygon: its position and texture coordinate. */
type Vertex = [x: number, y: number, u: number, v: number];

/**
 * Cut a mesh at every multiple of `period` along x, and move each part back
 * by whole periods into `[0, period]`.
 *
 * `RasterReprojector`'s `wrapX` keeps a mesh in one piece across a wrapping x
 * axis, so the mesh of an image that crosses the antimeridian runs past the
 * world's edge. This puts each part where the map draws it: inside one world,
 * the parts meeting at the seam.
 *
 * Each triangle that crosses a multiple of `period` is clipped against it
 * (Sutherland–Hodgman), and each part is fan-triangulated. A vertex on a cut
 * edge gets its texture coordinate by linear interpolation along that edge,
 * which is how the GPU interpolates it across the triangle anyway. A mesh that
 * lies inside one world comes back with the same vertices in the same order,
 * moved by whole periods.
 *
 * @param mesh The mesh, with x unwrapped across the wrap.
 * @param period The period of the x axis, such as one world width.
 */
export function clipMeshToWorld(mesh: Mesh2D, period: number): Mesh2D {
  const { positions, uvs, triangles } = mesh;

  // The world copies each triangle covers, from `first` to `last`. A triangle
  // that ends exactly on a world's edge doesn't reach into the next one.
  const first: number[] = [];
  const last: number[] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const xs = [0, 1, 2].map((j) => positions[2 * triangles[t + j]!]!);
    const a = Math.floor(Math.min(...xs) / period);
    first.push(a);
    last.push(Math.max(a, Math.ceil(Math.max(...xs) / period) - 1));
  }

  // Most meshes lie inside one world: move them whole.
  const copy = first[0] ?? 0;
  if (first.every((a, t) => a === copy && last[t] === copy)) {
    if (copy === 0) {
      return mesh;
    }
    return {
      positions: positions.map((p, i) => (i % 2 === 0 ? p - copy * period : p)),
      uvs,
      triangles,
    };
  }

  const out: Mesh2D = { positions: [], uvs: [], triangles: [] };
  const vertexAt = (i: number): Vertex => [
    positions[2 * i]!,
    positions[2 * i + 1]!,
    uvs[2 * i]!,
    uvs[2 * i + 1]!,
  ];
  const push = ([x, y, u, v]: Vertex, shift: number): number => {
    out.positions.push(x - shift, y);
    out.uvs.push(u, v);
    return out.positions.length / 2 - 1;
  };
  // Triangles that don't cross an edge share their vertices, per world.
  const shared = new Map<string, number>();
  const sharedVertex = (i: number, world: number): number => {
    const key = `${i}/${world}`;
    let index = shared.get(key);
    if (index === undefined) {
      index = push(vertexAt(i), world * period);
      shared.set(key, index);
    }
    return index;
  };

  for (let t = 0; t < triangles.length; t += 3) {
    const corners = [triangles[t]!, triangles[t + 1]!, triangles[t + 2]!];
    const a = first[t / 3]!;
    const b = last[t / 3]!;
    if (a === b) {
      for (const i of corners) {
        out.triangles.push(sharedVertex(i, a));
      }
      continue;
    }
    for (let world = a; world <= b; world++) {
      let polygon = corners.map(vertexAt);
      polygon = clipX(polygon, world * period, 1);
      polygon = clipX(polygon, (world + 1) * period, -1);
      if (polygon.length < 3) {
        continue;
      }
      // Clipping a triangle to a band leaves a convex polygon: fan it out.
      const ring = polygon.map((vertex) => push(vertex, world * period));
      for (let j = 1; j < ring.length - 1; j++) {
        out.triangles.push(ring[0]!, ring[j]!, ring[j + 1]!);
      }
    }
  }

  return out;
}

/**
 * Clip a polygon against the vertical line `x = edge` (one Sutherland–Hodgman
 * pass), keeping the side where `x >= edge` if `side` is `1`, or `x <= edge`
 * if it is `-1`.
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
