import { normalizeLongitudes } from "./antimeridian.js";
import type { Bounds, Point, ProjectionFunction } from "./transform-bounds.js";
import { unwrapAlong } from "./unwrap.js";

/**
 * The WGS84 bounds of a ring of points in a CRS, such as an image's corners.
 *
 * Longitudes are unwrapped by walking the ring from each point to the next,
 * so a ring across the antimeridian is bounded the short way: `west` is in
 * [-180°, 180°), and `east` can run past 180°, as MapLibre's `fitBounds`
 * accepts. A ring that goes all the way around the world gets -180° to 180°.
 *
 * Two limits:
 * - The walk stops at the last point, without the edge back to the first, so
 *   a ring around a pole isn't bounded correctly.
 * - Latitudes come from the points alone, so an edge that curves past them,
 *   such as a box's top edge in a conic projection, can reach past the
 *   bounds. Add points along such an edge to cover it.
 *
 * @param outline The ring's points in the CRS, in order around it.
 * @param projectTo4326 Projects a point of the CRS to longitude and latitude.
 * @returns `[west, south, east, north]` in degrees.
 */
export function geographicBounds(
  outline: Point[],
  projectTo4326: ProjectionFunction,
): Bounds {
  const corners = outline.map(([x, y]) => projectTo4326(x, y));

  // Unwrap each point's longitude by walking the outline to it from the
  // previous point, so a ring across the antimeridian goes the short way.
  const lons = [corners[0]![0]];
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1]!;
    const [x1, y1] = outline[i]!;
    lons.push(
      unwrapAlong(
        (t) => projectTo4326(x0 + t * (x1 - x0), y0 + t * (y1 - y0))[0],
        { start: lons[i - 1]!, period: 360 },
      ),
    );
  }
  const lats = corners.map(([, lat]) => lat);

  // Move west into [-180°, 180°), and east with it: east may then run past
  // 180°. All the way around the world gives -180° to 180°.
  return normalizeLongitudes([
    Math.min(...lons),
    Math.min(...lats),
    Math.max(...lons),
    Math.max(...lats),
  ]);
}
