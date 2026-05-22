import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { splitFloat64Array } from "./fp64.js";

/**
 * Default per-tile grid resolution for the globe scaffold. An `n × n` grid of
 * cells (so `(n+1)²` vertices). 32 keeps low-zoom tiles smooth on the sphere
 * while staying cheap (≈1089 verts / 2048 triangles per tile).
 */
export const GLOBE_GRID_SIZE = 32;

/**
 * THROWAWAY globe scaffold. Builds a uniform `gridSize × gridSize` triangle
 * grid over a tile in UV space and reprojects each vertex through the same
 * `forwardTransform` → `forwardReproject` chain {@link RasterReprojector} uses,
 * producing output positions in the layer's output CRS (lng/lat in globe mode).
 *
 * Why this exists: the adaptive Delatin mesh subdivides on *reprojection*
 * error, which is ~0 for an EPSG:4326 source, so it emits 2 triangles that
 * chord straight through the sphere and visibly facet at low zoom. A uniform
 * grid is a stopgap so the prototype is legible. It is NOT the real fix —
 * remove it once sphere-aware reprojection lands. See
 * `dev-docs/specs/2026-05-21-globe-view-design.md`.
 *
 * `width`/`height` match {@link RasterReprojector}'s convention (pass the
 * image dimensions + 1); pixel coordinates span `[0, width-1] × [0, height-1]`.
 */
export function buildUniformGridMesh(
  reprojectionFns: ReprojectionFns,
  width: number,
  height: number,
  gridSize: number = GLOBE_GRID_SIZE,
): {
  indices: Uint32Array;
  positions64High: Float32Array;
  positions64Low: Float32Array;
  texCoords: Float32Array;
} {
  const { forwardTransform, forwardReproject } = reprojectionFns;
  const cols = gridSize;
  const rows = gridSize;
  const numVerts = (cols + 1) * (rows + 1);

  const positions = new Float64Array(numVerts * 3);
  const texCoords = new Float32Array(numVerts * 2);

  let vi = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const v = r / rows;
      const pixelX = u * (width - 1);
      const pixelY = v * (height - 1);
      const [inputX, inputY] = forwardTransform(pixelX, pixelY);
      const [outX, outY] = forwardReproject(inputX, inputY);
      positions[vi * 3] = outX;
      positions[vi * 3 + 1] = outY;
      positions[vi * 3 + 2] = 0;
      texCoords[vi * 2] = u;
      texCoords[vi * 2 + 1] = v;
      vi++;
    }
  }

  const [positions64Low, positions64High] = splitFloat64Array(positions);

  const indices = new Uint32Array(cols * rows * 6);
  let ii = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * (cols + 1) + c;
      const i1 = i0 + 1;
      const i2 = i0 + (cols + 1);
      const i3 = i2 + 1;
      indices[ii++] = i0;
      indices[ii++] = i2;
      indices[ii++] = i1;
      indices[ii++] = i1;
      indices[ii++] = i2;
      indices[ii++] = i3;
    }
  }

  return { indices, positions64High, positions64Low, texCoords };
}
