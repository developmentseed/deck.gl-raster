/**
 * Define [**uv coordinates**](https://en.wikipedia.org/wiki/UV_mapping) as a float-valued image-local coordinate space where the top left is `(0, 0)` and the bottom right is `(1, 1)`.
 *
 * Define [**Barycentric coordinates**](https://en.wikipedia.org/wiki/Barycentric_coordinate_system) as float-valued triangle-local coordinates, represented as a 3-tuple of floats, where the tuple must add up to 1. The coordinate represents "how close to each vertex" a point in the interior of a triangle is. I.e. `(0, 0, 1)`, `(0, 1, 0)`, and `(1, 0, 0)`  are all valid barycentric coordinates that define one of the three vertices. `(1/3, 1/3, 1/3)` represents the centroid of a triangle. `(1/2, 1/2, 0)` represents a point that is halfway between vertices `a` and `b` and has "none" of vertex `c`.
 *
 *
 * ## Changes
 *
 * - Delatin coordinates are in terms of pixel space whereas here we use uv space.
 *
 * Originally copied from https://github.com/mapbox/delatin under the ISC
 * license, then subject to further modifications.
 */

import { nearestCopy, unwrapAlong } from "./wrap.js";

/**
 * Barycentric sample points in uv space for where to sample reprojection
 * errors.
 */
// TODO: Increase sampling density if uv area is large
// Note: these sample points should never be an existing vertex (that is, no
// vertex of a sample point should ever be `1`, such as `(0,0,1)`, because that
// would try to sample exactly at an existing triangle vertex).
const SAMPLE_POINTS: [number, number, number][] = [
  [1 / 3, 1 / 3, 1 / 3], // centroid
  [0.5, 0.5, 0], // edge 0–1
  [0.5, 0, 0.5], // edge 0–2
  [0, 0.5, 0.5], // edge 1–2
];

const DEFAULT_MAX_ERROR = 0.125;

/**
 * A seed triangulation for {@link RasterReprojector}, in delaunator's data
 * shape. All UV coordinates must lie in `[0, 1]`. The triangulation must be a
 * valid (ideally Delaunay) mesh — its triangles are NOT legalized on seeding.
 *
 * The fields deliberately match [delaunator](https://github.com/mapbox/delaunator)'s
 * output, so building a seed from a set of UV points is a one-liner — pass the
 * points (which must form a convex domain; delaunator triangulates the convex
 * hull of its input):
 *
 * ```ts
 * import Delaunator from "delaunator";
 *
 * const points: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
 * const d = Delaunator.from(points);
 * const seed: InitialTriangulation = {
 *   uvs: Array.from(d.coords),
 *   triangles: Array.from(d.triangles),
 *   halfedges: Array.from(d.halfedges),
 * };
 * ```
 *
 * delaunator is not a dependency of this package; consumers that want this
 * convenience add it themselves. A hand-built triangulation works too, as long
 * as it is a valid mesh with the halfedge convention below.
 */
export interface InitialTriangulation {
  /** Flat UV vertex coordinates `[u0, v0, u1, v1, ...]`, each in `[0, 1]`. */
  uvs: number[];
  /** Triangle vertex indices, 3 per triangle (indices into `uvs`). */
  triangles: number[];
  /**
   * Halfedge twins: `halfedges[e]` is the opposite halfedge of `e`, or `-1`
   * if `e` is on the boundary. Same convention as delaunator and the
   * reprojector's internal `_halfedges`.
   */
  halfedges: number[];
}

/**
 * Triangulate an axis-aligned UV rectangle `[uMin, vMin]`–`[uMax, vMax]` into an
 * {@link InitialTriangulation} (4 corner vertices, 2 triangles sharing the
 * p0–p3 diagonal).
 *
 * Seeding {@link RasterReprojector} with a sub-rectangle confines the mesh to
 * that region — e.g. to clamp an image's mesh to the valid Web Mercator
 * latitude band (see #182 / #351), pass that band's UV bounds.
 */
export function triangulateRectangle(
  uMin: number,
  vMin: number,
  uMax: number,
  vMax: number,
): InitialTriangulation {
  return {
    // p0=(uMin,vMin) p1=(uMax,vMin) p2=(uMin,vMax) p3=(uMax,vMax)
    uvs: [uMin, vMin, uMax, vMin, uMin, vMax, uMax, vMax],
    // t0 = (p3, p0, p2), t1 = (p0, p3, p1)
    triangles: [3, 0, 2, 0, 3, 1],
    // shared diagonal p0–p3: halfedge 0 <-> 3; all other edges are boundary
    halfedges: [3, -1, -1, 0, -1, -1],
  };
}

/**
 * The default seed: the full image in UV space. Reproduces the previous
 * hardcoded constructor init exactly, and is hardcoded (not delaunator-built)
 * so the package has no runtime triangulation dependency.
 */
const UNIT_SQUARE_TRIANGULATION: InitialTriangulation = triangulateRectangle(
  0,
  0,
  1,
  1,
);

/** The center of an {@link InitialTriangulation}'s UV bounds. */
function uvCenter(seed: InitialTriangulation): [number, number] {
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < seed.uvs.length; i += 2) {
    minU = Math.min(minU, seed.uvs[i]!);
    maxU = Math.max(maxU, seed.uvs[i]!);
    minV = Math.min(minV, seed.uvs[i + 1]!);
    maxV = Math.max(maxV, seed.uvs[i + 1]!);
  }
  return [(minU + maxU) / 2, (minV + maxV) / 2];
}

export interface ReprojectionFns {
  /**
   * Convert from UV coordinates to input CRS coordinates.
   *
   * This is the affine geotransform from the input image.
   */
  forwardTransform(x: number, y: number): [number, number];

  /**
   * Convert from input CRS coordinates back to UV coordinates.
   *
   * Inverse of the affine geotransform from the input image.
   */
  inverseTransform(x: number, y: number): [number, number];

  /**
   * Apply the forward projection from input CRS to output CRS.
   */
  forwardReproject(x: number, y: number): [number, number];

  /**
   * Apply the inverse projection from output CRS back to input CRS.
   */
  inverseReproject(x: number, y: number): [number, number];
}

/**
 * RasterReprojector performs a Delaunay triangulation-based reprojection of a
 * raster image.
 *
 * It takes as input a set of functions to associate pixel positions with
 * coordinates in the input and output CRS, as well as the dimensions of the
 * output image, and it produces a triangulated mesh that can be used to
 * reproject the input raster onto the output raster with bounded error.
 */
export class RasterReprojector {
  reprojectors: ReprojectionFns;

  /** Width of the image in pixels */
  width: number;

  /** Height of the image in pixels */
  height: number;

  /**
   * UV vertex coordinates (x, y), i.e.
   * [x0, y0, x1, y1, ...]
   *
   * These coordinates are floats that range from [0, 1] in both X and Y.
   */
  uvs: number[];

  /**
   * XY Positions in output CRS, computed via exact forward reprojection.
   */
  exactOutputPositions: number[];

  /**
   * triangle vertex indices
   */
  triangles: number[];

  private _halfedges: number[];

  /**
   * The UV texture coordinates of candidates found from
   * `findReprojectionCandidate`.
   *
   * Maybe in the future we'll want to store the barycentric coordinates instead
   * of just the uv coordinates?
   */
  private _candidatesUV: number[];

  /**
   * The exact output position of each triangle's candidate, kept in output
   * mode so a candidate that becomes a vertex is not projected again.
   *
   * Unused in `input` mode.
   */
  private _candidatesXY: number[];

  /** Where test-point errors are measured. See the constructor's options. */
  private _errorSpace: "input" | "output";

  /**
   * In `output` mode, one input pixel's size on the map.
   *
   * This is measured at the center of the meshed area. The unit of error is one
   * output pixel. This value is `1` in `input` mode.
   */
  private _pixelSize: number;

  /**
   * The period of the output's x axis, if it wraps around. See the
   * constructor's `wrapX` option.
   */
  private _wrapX: number | undefined;

  private _queueIndices: number[];

  private _queue: number[];
  private _errors: number[];
  private _pending: number[];
  private _pendingLen: number;

  constructor(
    reprojectors: ReprojectionFns,
    width: number,
    height: number = width,
    options: {
      initialTriangulation?: InitialTriangulation;
      /**
       * Where each test point's error is measured.
       *
       * - `"input"` (default): in input pixels. The GPU's position for the
       *   test point is mapped back to the input space with the inverse
       *   functions, and the error is its distance from the test point. This is
       *   similar to [gdalwarp's linear
       *   approximator](https://gdal.org/en/stable/programs/gdalwarp.html#approximate-transformation).
       * - `"output"`: in output pixels. The error is the distance on the map
       *   between where the test point belongs and where the GPU draws it, then
       *   divided by one input pixel's size on the map at the center of the
       *   meshed area. So the unit of `maxError` is still a number of pixels.
       *   The inverse functions are never called.
       *
       * This option is experimental and may change or be removed.
       */
      _errorSpace?: "input" | "output";
      /**
       * The period of the output's x axis, if it wraps around: one world width
       * (512 in deck.gl's common space) for Web Mercator, where an image can
       * cross the antimeridian.
       *
       * A projection returns x in one copy of the world, so an image that
       * crosses the wrap has corners on both sides of it. With `wrapX`, each
       * vertex goes on the copy next to its neighbors instead:
       *
       * - a test point's exact position is compared with the copy nearest
       *   where the GPU draws it, and keeps that copy when it becomes a vertex;
       * - each corner of the initial triangulation is unwrapped by walking the
       *   straight path to it from the center of its UV bounds, which is inside
       *   the image even when a corner is a pole.
       *
       * The mesh then stays in one piece across the wrap, and its x may run
       * past one period. Callers clip it at multiples of `wrapX`.
       *
       * Requires `_errorSpace: "output"`.
       */
      wrapX?: number;
    } = {},
  ) {
    this.reprojectors = reprojectors;
    this.width = width;
    this.height = height;

    this.uvs = []; // vertex coordinates (x, y)
    this.exactOutputPositions = [];
    this.triangles = []; // mesh triangle indices

    // additional triangle data
    this._halfedges = [];
    this._candidatesUV = [];
    this._candidatesXY = [];
    this._queueIndices = [];

    this._queue = []; // queue of added triangles
    this._errors = [];
    this._pending = []; // triangles pending addition to queue
    this._pendingLen = 0;

    const seed = options.initialTriangulation ?? UNIT_SQUARE_TRIANGULATION;
    this._errorSpace = options._errorSpace ?? "input";
    this._wrapX = options.wrapX;
    if (this._wrapX !== undefined) {
      if (this._errorSpace !== "output") {
        throw new Error(
          `RasterReprojector: wrapX needs _errorSpace "output", but it is "${this._errorSpace}".`,
        );
      }
      if (!(this._wrapX > 0 && Number.isFinite(this._wrapX))) {
        throw new Error(
          `RasterReprojector: wrapX must be a finite, positive period, but it is ${this._wrapX}.`,
        );
      }
    }
    this._pixelSize =
      this._errorSpace === "output" ? this._measurePixelSize(seed) : 1;
    this._seed(seed);
    this._flush();
  }

  /**
   * Seed the mesh from an {@link InitialTriangulation}. Adds every vertex (which
   * computes its exact output position), copies the triangle and halfedge arrays
   * directly (the seed is already a valid triangulation), and queues every
   * triangle for the first reprojection-error pass.
   */
  private _seed(seed: InitialTriangulation): void {
    const center = uvCenter(seed);
    for (let i = 0; i < seed.uvs.length; i += 2) {
      const u = seed.uvs[i]!;
      const v = seed.uvs[i + 1]!;
      if (this._wrapX !== undefined) {
        this._addPoint(u, v, this._unwrapFrom(center, [u, v], this._wrapX));
        continue;
      }
      this._addPoint(u, v);
    }
    for (let i = 0; i < seed.triangles.length; i++) {
      this.triangles[i] = seed.triangles[i]!;
      this._halfedges[i] = seed.halfedges[i]!;
    }
    const numTriangles = seed.triangles.length / 3;
    for (let t = 0; t < numTriangles; t++) {
      this._candidatesUV[2 * t] = 0;
      this._candidatesUV[2 * t + 1] = 0;
      this._candidatesXY[2 * t] = 0;
      this._candidatesXY[2 * t + 1] = 0;
      this._queueIndices[t] = -1;
      this._pending[this._pendingLen++] = t;
    }
  }

  /**
   * Refine the mesh until its maximum error gets below the given one
   *
   * @param maxError The maximum error the mesh should achieve, in pixels: input pixels, or in output mode, output pixels (one input pixel's size on the map at the center of the meshed area).
   * @param maxIterations Optional safeguard to prevent infinite loops in case of non-convergence. If the mesh fails to converge within this number of iterations, a warning will be logged and the function will return early.
   *
   * @return  {[type]}  [return description]
   */
  run(
    maxError: number = DEFAULT_MAX_ERROR,
    { maxIterations = 10000 } = {},
  ): void {
    if (maxError <= 0) {
      throw new Error("maxError must be positive");
    }

    // Note: this primarily happens near the poles, where we'll essentially
    // never converge
    let iterations = 0;
    while (this.getMaxError() > maxError) {
      this.refine();
      if (++iterations > maxIterations) {
        console.warn(
          `RasterReprojector: mesh refinement did not converge after ${iterations} iterations (maxError=${maxError}, currentError=${this.getMaxError()})`,
        );
        break;
      }
    }
  }

  // refine the mesh with a single point
  refine(): void {
    this._step();
    this._flush();
  }

  // max error of the current mesh
  getMaxError(): number {
    return this._errors[0]!;
  }

  // rasterize and queue all triangles that got added or updated in _step
  private _flush() {
    for (let i = 0; i < this._pendingLen; i++) {
      const t = this._pending[i]!;
      this._findReprojectionCandidate(t);
    }
    this._pendingLen = 0;
  }

  /**
   * Conversion of upstream's `_findCandidate` for reprojection error handling.
   *
   * @param t The index (into `this.triangles`) of the pending triangle to process.
   *
   * @return Doesn't return; instead modifies internal state.
   */
  private _findReprojectionCandidate(t: number): void {
    // Find the three vertices of this triangle
    const a = 2 * this.triangles[t * 3 + 0]!;
    const b = 2 * this.triangles[t * 3 + 1]!;
    const c = 2 * this.triangles[t * 3 + 2]!;

    // Get the UV coordinates of each vertex
    const p0u = this.uvs[a]!;
    const p0v = this.uvs[a + 1]!;
    const p1u = this.uvs[b]!;
    const p1v = this.uvs[b + 1]!;
    const p2u = this.uvs[c]!;
    const p2v = this.uvs[c + 1]!;

    // Get the **known** output CRS positions of each vertex
    const out0x = this.exactOutputPositions[a]!;
    const out0y = this.exactOutputPositions[a + 1]!;
    const out1x = this.exactOutputPositions[b]!;
    const out1y = this.exactOutputPositions[b + 1]!;
    const out2x = this.exactOutputPositions[c]!;
    const out2y = this.exactOutputPositions[c + 1]!;

    // A running tally of the maximum pixel error of each of our candidate
    // points
    let maxError = 0;

    // The point in uv coordinates that produced the max error
    // Note that upstream also initializes the point of max error to [0, 0]
    let maxErrorU: number = 0;
    let maxErrorV: number = 0;

    // In output mode, the exact output position of that point
    let maxErrorX = 0;
    let maxErrorY = 0;

    // Recall that the sample point is in barycentric coordinates
    for (const samplePoint of SAMPLE_POINTS) {
      // Get the UV coordinates of the sample point
      const uvSampleU = barycentricMix(
        p0u,
        p1u,
        p2u,
        samplePoint[0],
        samplePoint[1],
        samplePoint[2],
      );
      const uvSampleV = barycentricMix(
        p0v,
        p1v,
        p2v,
        samplePoint[0],
        samplePoint[1],
        samplePoint[2],
      );

      // Get the output CRS coordinates of the sample point by bilinear
      // interpolation
      const outSampleX = barycentricMix(
        out0x,
        out1x,
        out2x,
        samplePoint[0],
        samplePoint[1],
        samplePoint[2],
      );
      const outSampleY = barycentricMix(
        out0y,
        out1y,
        out2y,
        samplePoint[0],
        samplePoint[1],
        samplePoint[2],
      );

      // Convert uv to pixel space
      const pixelExactX = uvSampleU * (this.width - 1);
      const pixelExactY = uvSampleV * (this.height - 1);

      let err: number;
      let exactX = 0;
      let exactY = 0;
      if (this._errorSpace === "output") {
        // Where the sample point belongs on the map vs. where the GPU draws
        // it, in output pixels: one input pixel's size on the map.
        [exactX, exactY] = this._projectPixel(pixelExactX, pixelExactY);
        if (this._wrapX !== undefined) {
          // Measure to the copy nearest where the GPU draws the point. The
          // point keeps that copy if it becomes a vertex.
          exactX = nearestCopy(exactX, outSampleX, this._wrapX);
        }
        err =
          Math.hypot(exactX - outSampleX, exactY - outSampleY) /
          this._pixelSize;
      } else {
        // Reproject these linearly-interpolated coordinates **from output CRS
        // to input CRS**. This gives us the **exact position in input space**
        // of the linearly interpolated sample point in output space.
        const inputCRSSampled = this.reprojectors.inverseReproject(
          outSampleX,
          outSampleY,
        );

        // Find the pixel coordinates of the sampled point by using the
        // inverse geotransform.
        const pixelSampled = this.reprojectors.inverseTransform(
          inputCRSSampled[0],
          inputCRSSampled[1],
        );

        // 4. error in pixel space
        const dx = pixelExactX - pixelSampled[0];
        const dy = pixelExactY - pixelSampled[1];
        err = Math.hypot(dx, dy);
      }

      if (err > maxError) {
        maxError = err;
        maxErrorU = uvSampleU;
        maxErrorV = uvSampleV;
        maxErrorX = exactX;
        maxErrorY = exactY;
      }
    }

    //////
    // Now we can resume with code from upstream's `_findCandidate` that
    // modifies the internal state of what triangles to subdivide.

    // Check that the max error point is not one of the existing triangle
    // vertices
    // TODO: perhaps we should use float precision epsilon here?
    if (
      (maxErrorU === p0u && maxErrorV === p0v) ||
      (maxErrorU === p1u && maxErrorV === p1v) ||
      (maxErrorU === p2u && maxErrorV === p2v)
    ) {
      maxError = 0;
    }

    // update triangle metadata
    this._candidatesUV[2 * t] = maxErrorU;
    this._candidatesUV[2 * t + 1] = maxErrorV;
    this._candidatesXY[2 * t] = maxErrorX;
    this._candidatesXY[2 * t + 1] = maxErrorY;

    // add triangle to priority queue
    this._queuePush(t, maxError);
  }

  // process the next triangle in the queue, splitting it with a new point
  private _step(): void {
    // pop triangle with highest error from priority queue
    const t = this._queuePop();

    const e0 = t * 3 + 0;
    const e1 = t * 3 + 1;
    const e2 = t * 3 + 2;

    const p0 = this.triangles[e0]!;
    const p1 = this.triangles[e1]!;
    const p2 = this.triangles[e2]!;

    const au = this.uvs[2 * p0]!;
    const av = this.uvs[2 * p0 + 1]!;
    const bu = this.uvs[2 * p1]!;
    const bv = this.uvs[2 * p1 + 1]!;
    const cu = this.uvs[2 * p2]!;
    const cv = this.uvs[2 * p2 + 1]!;
    const pu = this._candidatesUV[2 * t]!;
    const pv = this._candidatesUV[2 * t + 1]!;

    // In output mode the candidate was already projected when it was measured.
    const pn =
      this._errorSpace === "output"
        ? this._addPoint(pu, pv, [
            this._candidatesXY[2 * t]!,
            this._candidatesXY[2 * t + 1]!,
          ])
        : this._addPoint(pu, pv);

    if (orient(au, av, bu, bv, pu, pv) === 0) {
      this._handleCollinear(pn, e0);
    } else if (orient(bu, bv, cu, cv, pu, pv) === 0) {
      this._handleCollinear(pn, e1);
    } else if (orient(cu, cv, au, av, pu, pv) === 0) {
      this._handleCollinear(pn, e2);
    } else {
      const h0 = this._halfedges[e0]!;
      const h1 = this._halfedges[e1]!;
      const h2 = this._halfedges[e2]!;

      const t0 = this._addTriangle(p0, p1, pn, h0, -1, -1, e0);
      const t1 = this._addTriangle(p1, p2, pn, h1, -1, t0 + 1);
      const t2 = this._addTriangle(p2, p0, pn, h2, t0 + 2, t1 + 1);

      this._legalize(t0);
      this._legalize(t1);
      this._legalize(t2);
    }
  }

  // add coordinates for a new vertex, with its exact output position if it
  // is already known
  private _addPoint(u: number, v: number, exact?: [number, number]): number {
    const i = this.uvs.length >> 1;
    this.uvs.push(u, v);

    if (exact) {
      this.exactOutputPositions.push(exact[0], exact[1]);
      return i;
    }

    // compute and store exact output position via reprojection
    const pixelX = u * (this.width - 1);
    const pixelY = v * (this.height - 1);
    const inputPosition = this.reprojectors.forwardTransform(pixelX, pixelY);
    const exactOutputPosition = this.reprojectors.forwardReproject(
      inputPosition[0],
      inputPosition[1],
    );
    this.exactOutputPositions.push(
      exactOutputPosition[0]!,
      exactOutputPosition[1]!,
    );

    return i;
  }

  /** Exact output position of a point given in pixel coordinates. */
  private _projectPixel(px: number, py: number): [number, number] {
    const input = this.reprojectors.forwardTransform(px, py);
    return this.reprojectors.forwardReproject(input[0], input[1]);
  }

  /**
   * Exact output position of a point given in UV coordinates, with its x on
   * the copy reached by walking the straight UV path to it from `from`.
   *
   * Used for the corners of the initial triangulation, which have no triangle
   * yet to compare against.
   */
  private _unwrapFrom(
    [u0, v0]: [number, number],
    [u, v]: [number, number],
    period: number,
  ): [number, number] {
    const xAt = (t: number) =>
      this._projectPixel(
        (u0 + t * (u - u0)) * (this.width - 1),
        (v0 + t * (v - v0)) * (this.height - 1),
      )[0];
    const x = unwrapAlong(xAt, { start: xAt(0), period });
    const y = this._projectPixel(
      u * (this.width - 1),
      v * (this.height - 1),
    )[1];
    return [x, y];
  }

  /**
   * One input pixel's size on the map at the center of the seed's UV bounds.
   *
   * Steps of half a pixel either side of that point give local derivatives `dx`
   * and `dy` of the projection, thus computing the local Jacobian.
   *
   *
   * The pixel covers the parallelogram they span, of area `|det J| = |r.x·d.y -
   * r.y·d.x|`, and its size is the side of a square with that area. This is the
   * unit of `output` mode's error, one output pixel.
   */
  private _measurePixelSize(seed: InitialTriangulation): number {
    // Center coordinates in uv and pixel space
    const [u, v] = uvCenter(seed);
    const px = u * (this.width - 1);
    const py = v * (this.height - 1);

    // Forward project 1 pixel width and height around the center pixel
    const left = this._projectPixel(px - 0.5, py);
    const right = this._projectPixel(px + 0.5, py);
    const up = this._projectPixel(px, py - 0.5);
    const down = this._projectPixel(px, py + 0.5);

    // Compute local derivatives and jacobian. With `wrapX`, the steps may
    // straddle the wrap, so take the short way around.
    const shortX = (x: number) =>
      this._wrapX === undefined ? x : nearestCopy(x, 0, this._wrapX);
    const rx = shortX(right[0] - left[0]);
    const ry = right[1] - left[1];
    const dx = shortX(down[0] - up[0]);
    const dy = down[1] - up[1];
    const size = Math.sqrt(Math.abs(rx * dy - ry * dx));

    if (!Number.isFinite(size) || size <= 0) {
      throw new Error(
        `RasterReprojector: _errorSpace "output" needs a finite, positive pixel size on the map, but the pixel at uv (${u}, ${v}) of a ${this.width}x${this.height} mesh measured ${size}.`,
      );
    }
    return size;
  }

  // add or update a triangle in the mesh
  private _addTriangle(
    a: number,
    b: number,
    c: number,
    ab: number,
    bc: number,
    ca: number,
    e: number = this.triangles.length,
  ) {
    const t = e / 3; // new triangle index

    // add triangle vertices
    this.triangles[e + 0] = a;
    this.triangles[e + 1] = b;
    this.triangles[e + 2] = c;

    // add triangle halfedges
    this._halfedges[e + 0] = ab;
    this._halfedges[e + 1] = bc;
    this._halfedges[e + 2] = ca;

    // link neighboring halfedges
    if (ab >= 0) {
      this._halfedges[ab] = e + 0;
    }
    if (bc >= 0) {
      this._halfedges[bc] = e + 1;
    }
    if (ca >= 0) {
      this._halfedges[ca] = e + 2;
    }

    // init triangle metadata
    this._candidatesUV[2 * t + 0] = 0;
    this._candidatesUV[2 * t + 1] = 0;
    this._candidatesXY[2 * t + 0] = 0;
    this._candidatesXY[2 * t + 1] = 0;
    this._queueIndices[t] = -1;

    // add triangle to pending queue for later rasterization
    this._pending[this._pendingLen++] = t;

    // return first halfedge index
    return e;
  }

  private _legalize(a: number): void {
    // if the pair of triangles doesn't satisfy the Delaunay condition
    // (p1 is inside the circumcircle of [p0, pl, pr]), flip them,
    // then do the same check/flip recursively for the new pair of triangles
    //
    //           pl                    pl
    //          /||\                  /  \
    //       al/ || \bl            al/    \a
    //        /  ||  \              /      \
    //       /  a||b  \    flip    /___ar___\
    //     p0\   ||   /p1   =>   p0\---bl---/p1
    //        \  ||  /              \      /
    //       ar\ || /br             b\    /br
    //          \||/                  \  /
    //           pr                    pr

    const b = this._halfedges[a]!;

    if (b < 0) {
      return;
    }

    const a0 = a - (a % 3);
    const b0 = b - (b % 3);
    const al = a0 + ((a + 1) % 3);
    const ar = a0 + ((a + 2) % 3);
    const bl = b0 + ((b + 2) % 3);
    const br = b0 + ((b + 1) % 3);
    const p0 = this.triangles[ar]!;
    const pr = this.triangles[a]!;
    const pl = this.triangles[al]!;
    const p1 = this.triangles[bl]!;
    const uvs = this.uvs;

    if (
      !inCircle(
        uvs[2 * p0]!,
        uvs[2 * p0 + 1]!,
        uvs[2 * pr]!,
        uvs[2 * pr + 1]!,
        uvs[2 * pl]!,
        uvs[2 * pl + 1]!,
        uvs[2 * p1]!,
        uvs[2 * p1 + 1]!,
      )
    ) {
      return;
    }

    const hal = this._halfedges[al]!;
    const har = this._halfedges[ar]!;
    const hbl = this._halfedges[bl]!;
    const hbr = this._halfedges[br]!;

    this._queueRemove(a0 / 3);
    this._queueRemove(b0 / 3);

    const t0 = this._addTriangle(p0, p1, pl, -1, hbl, hal, a0);
    const t1 = this._addTriangle(p1, p0, pr, t0, har, hbr, b0);

    this._legalize(t0 + 1);
    this._legalize(t1 + 2);
  }

  // handle a case where new vertex is on the edge of a triangle
  private _handleCollinear(pn: number, a: number): void {
    const a0 = a - (a % 3);
    const al = a0 + ((a + 1) % 3);
    const ar = a0 + ((a + 2) % 3);
    const p0 = this.triangles[ar]!;
    const pr = this.triangles[a]!;
    const pl = this.triangles[al]!;
    const hal = this._halfedges[al]!;
    const har = this._halfedges[ar]!;

    const b = this._halfedges[a]!;

    if (b < 0) {
      const t0 = this._addTriangle(pn, p0, pr, -1, har, -1, a0);
      const t1 = this._addTriangle(p0, pn, pl, t0, -1, hal);
      this._legalize(t0 + 1);
      this._legalize(t1 + 2);
      return;
    }

    const b0 = b - (b % 3);
    const bl = b0 + ((b + 2) % 3);
    const br = b0 + ((b + 1) % 3);
    const p1 = this.triangles[bl]!;
    const hbl = this._halfedges[bl]!;
    const hbr = this._halfedges[br]!;

    this._queueRemove(b0 / 3);

    const t0 = this._addTriangle(p0, pr, pn, har, -1, -1, a0);
    const t1 = this._addTriangle(pr, p1, pn, hbr, -1, t0 + 1, b0);
    const t2 = this._addTriangle(p1, pl, pn, hbl, -1, t1 + 1);
    const t3 = this._addTriangle(pl, p0, pn, hal, t0 + 2, t2 + 1);

    this._legalize(t0);
    this._legalize(t1);
    this._legalize(t2);
    this._legalize(t3);
  }

  // priority queue methods

  private _queuePush(t: number, error: number): void {
    const i = this._queue.length;
    this._queueIndices[t] = i;
    this._queue.push(t);
    this._errors.push(error);
    this._queueUp(i);
  }

  private _queuePop(): number {
    const n = this._queue.length - 1;
    this._queueSwap(0, n);
    this._queueDown(0, n);
    return this._queuePopBack()!;
  }

  private _queuePopBack(): number {
    const t = this._queue.pop()!;
    this._errors.pop();
    this._queueIndices[t] = -1;
    return t;
  }

  private _queueRemove(t: number): void {
    const i = this._queueIndices[t]!;
    if (i < 0) {
      const it = this._pending.indexOf(t);
      if (it !== -1) {
        this._pending[it] = this._pending[--this._pendingLen]!;
      } else {
        throw new Error("Broken triangulation (something went wrong).");
      }
      return;
    }
    const n = this._queue.length - 1;
    if (n !== i) {
      this._queueSwap(i, n);
      if (!this._queueDown(i, n)) {
        this._queueUp(i);
      }
    }
    this._queuePopBack();
  }

  private _queueLess(i: number, j: number): boolean {
    return this._errors[i]! > this._errors[j]!;
  }

  private _queueSwap(i: number, j: number): void {
    const pi = this._queue[i]!;
    const pj = this._queue[j]!;
    this._queue[i] = pj;
    this._queue[j] = pi;
    this._queueIndices[pi] = j;
    this._queueIndices[pj] = i;
    const e = this._errors[i]!;
    this._errors[i] = this._errors[j]!;
    this._errors[j] = e;
  }

  private _queueUp(j0: number): void {
    let j = j0;
    while (true) {
      const i = (j - 1) >> 1;
      if (i === j || !this._queueLess(j, i)) {
        break;
      }
      this._queueSwap(i, j);
      j = i;
    }
  }

  private _queueDown(i0: number, n: number): boolean {
    let i = i0;
    while (true) {
      const j1 = 2 * i + 1;
      if (j1 >= n || j1 < 0) {
        break;
      }
      const j2 = j1 + 1;
      let j = j1;
      if (j2 < n && this._queueLess(j2, j1)) {
        j = j2;
      }
      if (!this._queueLess(j, i)) {
        break;
      }
      this._queueSwap(i, j);
      i = j;
    }
    return i > i0;
  }
}

function orient(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  return (bx - cx) * (ay - cy) - (by - cy) * (ax - cx);
}

function inCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
): boolean {
  const dx = ax - px;
  const dy = ay - py;
  const ex = bx - px;
  const ey = by - py;
  const fx = cx - px;
  const fy = cy - py;

  const ap = dx * dx + dy * dy;
  const bp = ex * ex + ey * ey;
  const cp = fx * fx + fy * fy;

  return (
    dx * (ey * cp - bp * fy) -
      dy * (ex * cp - bp * fx) +
      ap * (ex * fy - ey * fx) <
    0
  );
}

/**
 * Interpolate the value at a given barycentric coordinate within a triangle.
 *
 * I've seen the name "mix" used before in graphics programming to refer to
 * barycentric linear interpolation.
 *
 * Note: the caller must call this method twice: once for u and once again for
 * v. We do this because we want to avoid allocating an array for the return
 * value.
 */
function barycentricMix(
  a: number,
  b: number,
  c: number,
  // Barycentric coordinates
  t0: number,
  t1: number,
  t2: number,
): number {
  return t0 * a + t1 * b + t2 * c;
}
