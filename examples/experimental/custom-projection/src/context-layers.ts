import type { Layer } from "@deck.gl/core";
import { PathLayer, SolidPolygonLayer } from "@deck.gl/layers";
import type { FromBounds } from "./custom-projection/index.js";

/** `[longitude, latitude]` in degrees. */
export type LngLat = [number, number];
/** `[x, y]` in map meters. */
export type XY = [number, number];
/** Projects `[lng, lat]` to map meters. */
export type Project = (position: number[]) => number[];

/** Natural Earth 1:50m coastlines (public domain), as used by deck.gl's docs. */
export const COASTLINES_URL =
  "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_coastline.geojson";

/** Max spacing, in degrees, between vertices of projected lines. */
const DENSIFY_STEP = 0.5;

/** Below this projected length, in meters, a boundary edge has collapsed. */
const COLLAPSED_METERS = 1;

/**
 * Insert vertices so consecutive points are at most `maxStep` degrees apart.
 * Straight lng/lat segments are curves in most projections.
 */
export function densify(path: LngLat[], maxStep: number): LngLat[] {
  if (path.length < 2) {
    return path.slice();
  }
  const result: LngLat[] = [path[0]!];
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1]!;
    const [x1, y1] = path[i]!;
    const steps = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / maxStep),
    );
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      result.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  return result;
}

/**
 * Clip a lng/lat path to `bounds`, splitting it where it leaves and
 * re-enters. Crossings are interpolated onto the boundary, so clipped lines
 * end exactly at the edge of the projection's domain.
 */
export function clipPath(path: LngLat[], bounds: FromBounds): LngLat[][] {
  const parts: LngLat[][] = [];
  let current: LngLat[] = [];
  for (let i = 1; i < path.length; i++) {
    const clipped = clipSegment(path[i - 1]!, path[i]!, bounds);
    if (!clipped) {
      if (current.length > 1) {
        parts.push(current);
      }
      current = [];
      continue;
    }
    const [a, b] = clipped;
    const last = current[current.length - 1];
    if (!last || last[0] !== a[0] || last[1] !== a[1]) {
      if (current.length > 1) {
        parts.push(current);
      }
      current = [a];
    }
    current.push(b);
  }
  if (current.length > 1) {
    parts.push(current);
  }
  return parts;
}

/** Liang–Barsky clip of one segment; `null` if it lies outside `bounds`. */
function clipSegment(
  a: LngLat,
  b: LngLat,
  [minX, minY, maxX, maxY]: FromBounds,
): [LngLat, LngLat] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a[0] - minX],
    [dx, maxX - a[0]],
    [-dy, a[1] - minY],
    [dy, maxY - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) {
        return null;
      }
      continue;
    }
    const t = q / p;
    if (p < 0) {
      t0 = Math.max(t0, t);
    } else {
      t1 = Math.min(t1, t);
    }
    if (t0 > t1) {
      return null;
    }
  }
  return [
    t0 === 0 ? a : [a[0] + dx * t0, a[1] + dy * t0],
    t1 === 1 ? b : [a[0] + dx * t1, a[1] + dy * t1],
  ];
}

/**
 * Project a lng/lat path to map meters, splitting it wherever the projection
 * returns non-finite coordinates.
 */
export function projectPath(path: LngLat[], project: Project): XY[][] {
  const parts: XY[][] = [];
  let current: XY[] = [];
  for (const [lng, lat] of path) {
    const [x, y] = project([lng, lat]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      current.push([x!, y!]);
    } else {
      if (current.length > 1) {
        parts.push(current);
      }
      current = [];
    }
  }
  if (current.length > 1) {
    parts.push(current);
  }
  return parts;
}

/** Meridians and parallels at multiples of `step` within `bounds`. */
export function graticule(
  [minLng, minLat, maxLng, maxLat]: FromBounds,
  step: { lng: number; lat: number },
): LngLat[][] {
  const lines: LngLat[][] = [];
  // Around the whole globe, -180° and +180° are the same meridian: draw it
  // once (where it is a map edge, the domain outline draws it anyway).
  const wraps = maxLng - minLng >= 360;
  for (
    let lng = Math.ceil(minLng / step.lng) * step.lng;
    wraps ? lng < maxLng : lng <= maxLng;
    lng += step.lng
  ) {
    lines.push([
      [lng, minLat],
      [lng, maxLat],
    ]);
  }
  for (
    let lat = Math.ceil(minLat / step.lat) * step.lat;
    lat <= maxLat;
    lat += step.lat
  ) {
    // A parallel at a pole is a single point.
    if (Math.abs(lat) < 90) {
      lines.push([
        [minLng, lat],
        [maxLng, lat],
      ]);
    }
  }
  return lines;
}

/**
 * The visible edges of the projection's domain, in map meters.
 *
 * Drops edges that are not edges of the projected map: a pole that collapses
 * to a point, or the ±180° meridians of an azimuthal projection, which
 * coincide inside the map.
 */
export function domainOutline(bounds: FromBounds, project: Project): XY[][] {
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const edge = (from: LngLat, to: LngLat) =>
    projectPath(densify([from, to], DENSIFY_STEP), project).flat();
  const bottom = edge([minLng, minLat], [maxLng, minLat]);
  const right = edge([maxLng, minLat], [maxLng, maxLat]);
  const top = edge([maxLng, maxLat], [minLng, maxLat]);
  const left = edge([minLng, maxLat], [minLng, minLat]);

  const length = (path: XY[]) => {
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      total += Math.hypot(
        path[i]![0] - path[i - 1]![0],
        path[i]![1] - path[i - 1]![1],
      );
    }
    return total;
  };

  const seamIsInterior =
    maxLng - minLng >= 360 &&
    right.length > 0 &&
    left.length > 0 &&
    Math.hypot(
      right[0]![0] - left[left.length - 1]![0],
      right[0]![1] - left[left.length - 1]![1],
    ) < COLLAPSED_METERS;

  const edges = [bottom, top];
  if (!seamIsInterior) {
    edges.push(right, left);
  }
  return edges.filter((path) => length(path) >= COLLAPSED_METERS);
}

/** The projection's domain as one polygon ring in map meters (the "ocean"). */
export function domainPolygon(bounds: FromBounds, project: Project): XY[] {
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const ring = densify(
    [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ],
    DENSIFY_STEP,
  );
  return projectPath(ring, project).flat();
}

/** Extract every line from a GeoJSON FeatureCollection of (Multi)LineStrings. */
export function geojsonLines(geojson: {
  features: { geometry: { type: string; coordinates: unknown } | null }[];
}): LngLat[][] {
  const lines: LngLat[][] = [];
  for (const { geometry } of geojson.features) {
    if (geometry?.type === "LineString") {
      lines.push(geometry.coordinates as LngLat[]);
    } else if (geometry?.type === "MultiLineString") {
      lines.push(...(geometry.coordinates as LngLat[][]));
    }
  }
  return lines;
}

/** Clip lng/lat lines to the domain, densify, and project them. */
export function projectLines(
  lines: LngLat[][],
  bounds: FromBounds,
  project: Project,
): XY[][] {
  const projected: XY[][] = [];
  for (const line of lines) {
    for (const part of clipPath(line, bounds)) {
      projected.push(...projectPath(densify(part, DENSIFY_STEP), project));
    }
  }
  return projected;
}

/** Options for {@link renderContextLayers}. */
export interface ContextLayerOptions {
  /** Prefix for layer ids; change it when the projection changes. */
  idPrefix: string;
  /** The projection's domain. */
  fromBounds: FromBounds;
  /** `[lng, lat]` → map meters. */
  project: Project;
  /** Graticule spacing in degrees. */
  graticuleStep: { lng: number; lat: number };
  /** Coastline lines in lng/lat, once loaded. */
  coastlines: LngLat[][] | null;
  /** Whether to draw the graticule. */
  showGraticule: boolean;
  /** Whether to draw coastlines. */
  showCoastlines: boolean;
}

/**
 * Vector context for the map, preprojected on the CPU into map meters and
 * drawn with `coordinateSystem: "cartesian"`.
 *
 * Upstream's view preprojects lng/lat positions itself (with `resolution` for
 * curve subdivision) once visgl/deck.gl#10742 lands; cartesian map-meter
 * positions work in both the shim and upstream.
 *
 * Returns the layers to draw below the raster and above it.
 */
export function renderContextLayers(options: ContextLayerOptions): {
  below: Layer[];
  above: Layer[];
} {
  const {
    idPrefix,
    fromBounds,
    project,
    graticuleStep,
    coastlines,
    showGraticule,
    showCoastlines,
  } = options;

  const below: Layer[] = [
    new SolidPolygonLayer<XY[]>({
      id: `${idPrefix}-ocean`,
      data: [domainPolygon(fromBounds, project)],
      getPolygon: (ring) => ring,
      getFillColor: [18, 32, 52],
      coordinateSystem: "cartesian",
    }),
  ];

  const above: Layer[] = [];
  if (showGraticule) {
    above.push(
      new PathLayer<XY[]>({
        id: `${idPrefix}-graticule`,
        data: projectLines(
          graticule(fromBounds, graticuleStep),
          fromBounds,
          project,
        ),
        getPath: (path) => path,
        getColor: [255, 255, 255, 60],
        getWidth: 1,
        widthUnits: "pixels",
        coordinateSystem: "cartesian",
      }),
    );
  }
  if (showCoastlines && coastlines) {
    const paths = projectLines(coastlines, fromBounds, project);
    // A light line over a dark casing reads on both pale and dark rasters.
    above.push(
      new PathLayer<XY[]>({
        id: `${idPrefix}-coastlines-casing`,
        data: paths,
        getPath: (path) => path,
        getColor: [10, 16, 28, 140],
        getWidth: 2.5,
        widthUnits: "pixels",
        coordinateSystem: "cartesian",
      }),
      new PathLayer<XY[]>({
        id: `${idPrefix}-coastlines`,
        data: paths,
        getPath: (path) => path,
        getColor: [240, 244, 248, 230],
        getWidth: 1,
        widthUnits: "pixels",
        coordinateSystem: "cartesian",
      }),
    );
  }
  above.push(
    new PathLayer<XY[]>({
      id: `${idPrefix}-outline`,
      data: domainOutline(fromBounds, project),
      getPath: (path) => path,
      getColor: [150, 170, 200],
      getWidth: 1.5,
      widthUnits: "pixels",
      coordinateSystem: "cartesian",
    }),
  );
  return { below, above };
}
