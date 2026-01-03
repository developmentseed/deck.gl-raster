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

export class RasterReprojector {
  reprojectors: ReprojectionFns;
  width: number;
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
  private _queueIndices: number[];

  private _queue: number[];
  private _errors: number[];
  private _pending: number[];
  private _pendingLen: number;

  constructor(
    reprojectors: ReprojectionFns,
    width: number,
    height: number = width,
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
    this._queueIndices = [];

    this._queue = []; // queue of added triangles
    this._errors = [];
    this._pending = []; // triangles pending addition to queue
    this._pendingLen = 0;

    // The two initial triangles cover the entire input texture in UV space, so
    // they range from [0, 0] to [1, 1] in u and v.
    const u1 = 1;
    const v1 = 1;
    const p0 = this._addPoint(0, 0);
    const p1 = this._addPoint(u1, 0);
    const p2 = this._addPoint(0, v1);
    const p3 = this._addPoint(u1, v1);

    // add initial two triangles
    const t0 = this._addTriangle(p3, p0, p2, -1, -1, -1);
    this._addTriangle(p0, p3, p1, t0, -1, -1);
    this._flush();
  }

  // refine the mesh until its maximum error gets below the given one
  run(maxError: number = DEFAULT_MAX_ERROR): void {
    if (maxError <= 0) {
      throw new Error("maxError must be positive");
    }

    while (this.getMaxError() > maxError) {
      this.refine();
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
   * @param   {number}  t  The index (into `this.triangles`) of the pending triangle to process.
   *
   * @return  {void}    Doesn't return; instead modifies internal state.
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

      // Reproject these linearly-interpolated coordinates **from target CRS
      // to input CRS**. This gives us the **exact position in input space**
      // of the linearly interpolated sample point in output space.
      const inputCRSSampled = this.reprojectors.inverseReproject(
        outSampleX,
        outSampleY,
      );

      // Find the pixel coordinates of the sampled point by using the inverse
      // geotransform.
      const pixelSampled = this.reprojectors.inverseTransform(
        inputCRSSampled[0],
        inputCRSSampled[1],
      );

      // 4. error in pixel space
      const dx = pixelExactX - pixelSampled[0];
      const dy = pixelExactY - pixelSampled[1];
      const err = Math.hypot(dx, dy);

      if (err > maxError) {
        maxError = err;
        maxErrorU = uvSampleU;
        maxErrorV = uvSampleV;
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

    const pn = this._addPoint(pu, pv);

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

  // add coordinates for a new vertex
  private _addPoint(u: number, v: number): number {
    const i = this.uvs.length >> 1;
    this.uvs.push(u, v);

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

  // add or update a triangle in the mesh
  _addTriangle(
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
