export type Point = [number, number];

export type Bounds = [minX: number, minY: number, maxX: number, maxY: number];

export type ProjectionFunction = (x: number, y: number) => Point;

/**
 * Reproject a bounding box through a projection function, densifying edges to
 * account for non-linear projections.
 *
 * @param project - function that maps (x, y) in source CRS to (x, y) in target CRS
 * @param left - min X in source CRS
 * @param bottom - min Y in source CRS
 * @param right - max X in source CRS
 * @param top - max Y in source CRS
 * @param options.densifyPts - number of intermediate points along each edge (default 21)
 * @returns [minX, minY, maxX, maxY] in the target CRS
 */
export function reprojectBounds(
  project: ProjectionFunction,
  left: number,
  bottom: number,
  right: number,
  top: number,
  { densifyPts = 21 }: { densifyPts?: number } = {},
): Bounds {
  const corners: Point[] = [
    [left, bottom],
    [right, bottom],
    [right, top],
    [left, top],
  ];

  const points: Point[] = [];
  for (let i = 0; i < corners.length; i++) {
    const from = corners[i]!;
    const to = corners[(i + 1) % corners.length]!;
    // Include start corner + intermediate points (end corner is start of next edge)
    for (let j = 0; j <= densifyPts; j++) {
      const t = j / (densifyPts + 1);
      points.push([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
      ]);
    }
  }

  let outMinX = Infinity;
  let outMinY = Infinity;
  let outMaxX = -Infinity;
  let outMaxY = -Infinity;

  for (const [x, y] of points) {
    const [px, py] = project(x, y);
    if (px < outMinX) outMinX = px;
    if (py < outMinY) outMinY = py;
    if (px > outMaxX) outMaxX = px;
    if (py > outMaxY) outMaxY = py;
  }

  return [outMinX, outMinY, outMaxX, outMaxY];
}
