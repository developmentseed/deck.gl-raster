import Delaunator from "delaunator";
import type { InitialTriangulation } from "./delatin.js";

/**
 * Build a Delaunay {@link InitialTriangulation} from a set of UV points via
 * delaunator. The points must lie in `[0, 1]` and define a convex domain
 * (delaunator triangulates the convex hull of its input).
 *
 * This module is the only one that imports delaunator; consumers that don't
 * call this function tree-shake it out.
 *
 * @param points UV points as `[u, v]` pairs.
 */
export function createInitialConditions(
  points: [number, number][],
): InitialTriangulation {
  const delaunay = Delaunator.from(points);
  return {
    uvs: Array.from(delaunay.coords),
    triangles: Array.from(delaunay.triangles),
    halfedges: Array.from(delaunay.halfedges),
  };
}
