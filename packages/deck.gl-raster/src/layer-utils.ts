import type { _Tile2DHeader as Tile2DHeader } from "@deck.gl/geo-layers";
import { PathLayer, TextLayer } from "@deck.gl/layers";
import { nearestCopy, unwrapAlong } from "@developmentseed/proj";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { RasterTileMetadata } from "./raster-tileset/index.js";

/**
 * Longest step, in degrees of longitude, in a tile's outline. `PathLayer`'s
 * `wrapLongitude` reads each step as the short way around, so a step of 180°
 * or more would go the wrong way.
 */
const MAX_OUTLINE_STEP = 90;

export function renderDebugTileOutline(
  id: string,
  tile: Tile2DHeader & RasterTileMetadata,
  forwardTo4326: ReprojectionFns["forwardReproject"],
) {
  const { projectedCorners } = tile;

  // Create a closed path in WGS84 projection around the tile bounds
  //
  // The tile has a `bbox` field which is already the bounding box in WGS84,
  // but that uses `transformBounds` and densifies edges. So the corners of
  // the bounding boxes don't line up with each other.
  //
  // In this case in the debug mode, it looks better if we ignore the actual
  // non-linearities of the edges and just draw a box connecting the
  // reprojected corners. In any case, the _image itself_ will be densified
  // on the edges as a feature of the mesh generation.
  const { topLeft, topRight, bottomRight, bottomLeft } = projectedCorners;
  const corners = [topLeft, topRight, bottomRight, bottomLeft, topLeft];

  // Unwrap each corner's longitude by walking the tile's edge to it from the
  // previous corner. Then a tile across the antimeridian is outlined the short
  // way, and a whole-world tile keeps its width. `wrapLongitude` cuts the
  // path at the antimeridian.
  const outline: [number, number][] = [forwardTo4326(topLeft[0], topLeft[1])];
  for (let i = 1; i < corners.length; i++) {
    const [x0, y0] = corners[i - 1]!;
    const [x1, y1] = corners[i]!;
    const lng = unwrapAlong(
      (t) => forwardTo4326(x0 + t * (x1 - x0), y0 + t * (y1 - y0))[0],
      { start: outline[i - 1]![0], period: 360 },
    );
    outline.push([lng, forwardTo4326(x1, y1)[1]]);
  }
  const path = splitLongSteps(outline);

  // Label the tile at its center, in the copy of the world nearest 0°.
  const center = [
    nearestCopy((outline[0]![0] + outline[2]![0]) / 2, 0, 360),
    (outline[0]![1] + outline[2]![1]) / 2,
  ];
  const labelLayer = new TextLayer({
    id: `${id}-label`,
    data: [
      {
        position: center,
        text: `x=${tile.index.x} y=${tile.index.y} z=${tile.index.z}`,
      },
    ],
    getColor: [255, 255, 255, 255],
    getSize: 24,
    sizeUnits: "pixels",
    outlineWidth: 3,
    outlineColor: [0, 0, 0, 255],
    fontSettings: { sdf: true },
  });

  const outlineLayer = new PathLayer({
    id,
    data: [path],
    getPath: (d) => d,
    getColor: [255, 0, 0, 255], // Red
    getWidth: 2,
    widthUnits: "pixels",
    pickable: false,
    wrapLongitude: true,
  });

  return [outlineLayer, labelLayer];
}

/**
 * Split each step of a path that spans more than {@link MAX_OUTLINE_STEP}
 * degrees of longitude into shorter, straight pieces.
 */
function splitLongSteps(points: [number, number][]): [number, number][] {
  const path = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const [lng0, lat0] = points[i - 1]!;
    const [lng1, lat1] = points[i]!;
    const pieces = Math.max(
      1,
      Math.ceil(Math.abs(lng1 - lng0) / MAX_OUTLINE_STEP),
    );
    for (let j = 1; j <= pieces; j++) {
      const t = j / pieces;
      path.push([lng0 + t * (lng1 - lng0), lat0 + t * (lat1 - lat0)]);
    }
  }
  return path;
}
