import type {
  Bounds,
  Corners,
  ProjectionFunction,
} from "@developmentseed/deck.gl-raster";
import type { InitialTriangulation } from "@developmentseed/raster-reproject";
import { triangulateRectangle } from "@developmentseed/raster-reproject";

/** A 2D point `[x, y]`. */
export type Point = [number, number];

/** The whole globe, the domain assumed when a view doesn't provide one. */
const WORLD_BOUNDS: Bounds = [-180, -90, 180, 90];

/** Tolerance, in degrees, for the "rows are parallels" checks. */
const DEGREE_EPSILON = 1e-6;

/** Tolerance, in pixels, for comparing domain rectangles. */
const PIXEL_EPSILON = 1e-6;

/** Tolerance, in UV units, for comparing seed rectangles. */
const UV_EPSILON = 1e-9;

/**
 * Bilinearly interpolate across a quad: `(0, 0)` is `topLeft`, `(1, 1)` is
 * `bottomRight`.
 */
export function bilerp(corners: Corners, s: number, t: number): Point {
  const { topLeft, topRight, bottomLeft, bottomRight } = corners;
  const topX = topLeft[0] + (topRight[0] - topLeft[0]) * s;
  const topY = topLeft[1] + (topRight[1] - topLeft[1]) * s;
  const bottomX = bottomLeft[0] + (bottomRight[0] - bottomLeft[0]) * s;
  const bottomY = bottomLeft[1] + (bottomRight[1] - bottomLeft[1]) * s;
  return [topX + (bottomX - topX) * t, topY + (bottomY - topY) * t];
}

/**
 * Sample `perEdge` points along each edge of a quad, walking clockwise from
 * the top-left corner. The ring is open: the first point is not repeated.
 *
 * Projected tile edges curve, so the samples (not the four corners) are what
 * bound a tile's footprint in the map CRS.
 */
export function sampleBoundary(corners: Corners, perEdge: number): Point[] {
  const ring: Point[] = [];
  for (let i = 0; i < perEdge; i++) {
    ring.push(bilerp(corners, i / perEdge, 0));
  }
  for (let i = 0; i < perEdge; i++) {
    ring.push(bilerp(corners, 1, i / perEdge));
  }
  for (let i = 0; i < perEdge; i++) {
    ring.push(bilerp(corners, 1 - i / perEdge, 1));
  }
  for (let i = 0; i < perEdge; i++) {
    ring.push(bilerp(corners, 0, 1 - i / perEdge));
  }
  return ring;
}

/**
 * Sample an `n` × `n` grid of points strictly inside a quad (cell centers),
 * row by row from the top-left.
 */
export function sampleGrid(corners: Corners, n: number): Point[] {
  const points: Point[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      points.push(bilerp(corners, (i + 0.5) / n, (j + 0.5) / n));
    }
  }
  return points;
}

/** Whether `point` lies within `bounds` (edges included). */
export function insideBounds([x, y]: Point, bounds: Bounds): boolean {
  return x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3];
}

/** Absolute area of a closed polygon ring (shoelace formula). */
export function ringArea(ring: Point[]): number {
  let twiceArea = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[(i + 1) % ring.length]!;
    twiceArea += x0 * y1 - x1 * y0;
  }
  return Math.abs(twiceArea) / 2;
}

/** Axis-aligned bounds of the finite points, or `null` if there are none. */
export function pointsBounds(points: Point[]): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return minX <= maxX ? [minX, minY, maxX, maxY] : null;
}

/** Whether two bounds overlap (touching edges count). */
export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * A rectangle in tile-local pixel coordinates, `[x0, y0, x1, y1]`, with
 * `(0, 0)` at the tile's top-left corner.
 */
export type PixelRect = [number, number, number, number];

/** A tile's corners converted to WGS84 `[lng, lat]`. */
export type LngLatCorners = Corners;

/** Convert a tile's source-CRS corners to lng/lat. */
export function cornersToLngLat(
  corners: Corners,
  sourceToLngLat: ProjectionFunction,
): LngLatCorners {
  return {
    topLeft: sourceToLngLat(...corners.topLeft),
    topRight: sourceToLngLat(...corners.topRight),
    bottomLeft: sourceToLngLat(...corners.bottomLeft),
    bottomRight: sourceToLngLat(...corners.bottomRight),
  };
}

/**
 * Whether a tile's rows are parallels and its columns meridians — true for
 * EPSG:4326, Web Mercator and other cylindrical grids.
 */
export function isGeographicGrid(corners: LngLatCorners): boolean {
  const { topLeft, topRight, bottomLeft, bottomRight } = corners;
  return (
    Math.abs(topLeft[1] - topRight[1]) < DEGREE_EPSILON &&
    Math.abs(bottomLeft[1] - bottomRight[1]) < DEGREE_EPSILON &&
    Math.abs(topLeft[0] - bottomLeft[0]) < DEGREE_EPSILON &&
    Math.abs(topRight[0] - bottomRight[0]) < DEGREE_EPSILON
  );
}

/** Wrap a longitude difference into `[-180, 180)`. */
export function wrapLongitudeDelta(delta: number): number {
  return ((((delta + 180) % 360) + 360) % 360) - 180;
}

/** Options for {@link computeDomainPixelRect}. */
export interface DomainPixelRectOptions {
  /** The tile's corners in the source CRS. */
  corners: Corners;
  /** Nominal tile width in pixels (the extent `corners` spans). */
  tileWidth: number;
  /** Nominal tile height in pixels. */
  tileHeight: number;
  /** Source CRS → WGS84 `[lng, lat]`. */
  sourceToLngLat: ProjectionFunction;
  /** WGS84 `[lng, lat]` → source CRS. */
  lngLatToSource: ProjectionFunction;
  /** Source CRS → tile-local pixel coordinates (the tile's inverse affine). */
  inverseTransform: ProjectionFunction;
  /**
   * The projection's domain `[minLng, minLat, maxLng, maxLat]`. Defaults to
   * the whole globe, which still keeps tiles off the poles.
   */
  fromBounds: Bounds | undefined;
}

/**
 * The part of a geographic tile that lies inside the projection's domain
 * (and away from the poles), as a pixel rectangle.
 *
 * This generalizes deck.gl-raster's Web Mercator latitude clamp
 * (`createInitialWebMercatorTriangulation`) to an arbitrary lng/lat box. It
 * only handles tiles whose rows are parallels and whose columns are
 * meridians (EPSG:4326, Web Mercator, and other cylindrical grids), where the
 * domain is an axis-aligned rectangle in pixel space. The pixel position of
 * each domain edge comes from the inverse projection, so latitude does not
 * need to vary linearly down the tile.
 *
 * The result is in pixels rather than UVs because edge tiles are often
 * clipped to the image: the UVs depend on the decoded tile's size, which is
 * only known at render time (see {@link pixelRectToTriangulation}).
 *
 * The rectangle also stops one source row short of either pole. In a polar
 * projection a geographic tile's row at ±90° collapses to a point; the
 * reprojector measures error in source pixels and, in the degenerate triangles
 * fanning out from the pole, never converges. The closer to the pole the mesh
 * reaches, the finer it has to be split, so trimming exactly one row keeps the
 * hole at one source pixel (a few screen pixels at most) at every level.
 *
 * @returns the rectangle; `undefined` when no clamp is needed or the tile is
 *   not a geographic grid (the caller then meshes the full tile); `null` when
 *   the tile lies entirely outside the domain.
 */
export function computeDomainPixelRect(
  options: DomainPixelRectOptions,
): PixelRect | undefined | null {
  const {
    corners,
    tileWidth,
    tileHeight,
    sourceToLngLat,
    lngLatToSource,
    inverseTransform,
    fromBounds = WORLD_BOUNDS,
  } = options;

  const lngLatCorners = cornersToLngLat(corners, sourceToLngLat);
  if (!isGeographicGrid(lngLatCorners)) {
    return undefined;
  }
  const { topLeft, topRight, bottomLeft } = lngLatCorners;

  const [minLng, minLat, maxLng, maxLat] = fromBounds;
  const rowDegrees = Math.abs(topLeft[1] - bottomLeft[1]) / tileHeight;
  const poleGuard = 90 - rowDegrees;
  const latLow = Math.max(minLat, -poleGuard);
  const latHigh = Math.min(maxLat, poleGuard);

  const tileLats = [topLeft[1], bottomLeft[1]];
  const tileLngs = [topLeft[0], topRight[0]];
  const lngMid = (tileLngs[0]! + tileLngs[1]!) / 2;
  const latMid = (tileLats[0]! + tileLats[1]!) / 2;

  const clamp = (value: number, max: number) =>
    Math.max(0, Math.min(max, value));

  let y0 = 0;
  let y1 = tileHeight;
  if (Math.min(...tileLats) < latLow || Math.max(...tileLats) > latHigh) {
    const yAt = (lat: number) =>
      inverseTransform(...lngLatToSource(lngMid, lat))[1];
    const yLow = yAt(latLow);
    const yHigh = yAt(latHigh);
    y0 = clamp(Math.min(yLow, yHigh), tileHeight);
    y1 = clamp(Math.max(yLow, yHigh), tileHeight);
  }

  let x0 = 0;
  let x1 = tileWidth;
  if (Math.min(...tileLngs) < minLng || Math.max(...tileLngs) > maxLng) {
    const xAt = (lng: number) =>
      inverseTransform(...lngLatToSource(lng, latMid))[0];
    const xLow = xAt(minLng);
    const xHigh = xAt(maxLng);
    x0 = clamp(Math.min(xLow, xHigh), tileWidth);
    x1 = clamp(Math.max(xLow, xHigh), tileWidth);
  }

  if (x1 - x0 < PIXEL_EPSILON || y1 - y0 < PIXEL_EPSILON) {
    return null;
  }
  if (
    x0 < PIXEL_EPSILON &&
    y0 < PIXEL_EPSILON &&
    x1 > tileWidth - PIXEL_EPSILON &&
    y1 > tileHeight - PIXEL_EPSILON
  ) {
    return undefined;
  }
  return [x0, y0, x1, y1];
}

/**
 * Seed triangulation covering `rect` of a decoded tile that is
 * `width` × `height` pixels, or `undefined` if the rectangle covers the whole
 * tile.
 *
 * `RasterLayer` maps UV `(1, 1)` to pixel `(width, height)`, so the UVs are
 * simply the rectangle divided by the decoded size.
 */
export function pixelRectToTriangulation(
  rect: PixelRect,
  width: number,
  height: number,
): InitialTriangulation | undefined {
  const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
  const u0 = clamp01(rect[0] / width);
  const v0 = clamp01(rect[1] / height);
  const u1 = clamp01(rect[2] / width);
  const v1 = clamp01(rect[3] / height);
  if (u1 - u0 < UV_EPSILON || v1 - v0 < UV_EPSILON) {
    return undefined;
  }
  if (
    u0 < UV_EPSILON &&
    v0 < UV_EPSILON &&
    u1 > 1 - UV_EPSILON &&
    v1 > 1 - UV_EPSILON
  ) {
    return undefined;
  }
  return triangulateRectangle(u0, v0, u1, v1);
}
