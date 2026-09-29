import type { _Tile2DHeader as Tile2DHeader } from "@deck.gl/geo-layers";
import { PathLayer, TextLayer } from "@deck.gl/layers";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { RasterTileMetadata } from "./raster-tileset/index.js";
import type { ProjectionFunction } from "./raster-tileset/types.js";

/**
 * Closed 5-point box path for a pixel-space rectangle `[x0, 0] .. [x1,
 * height]`, mapped through `forwardTransform` (pixel → source CRS) then
 * `forwardReproject` (source CRS → common space).
 */
function pieceBoxPath(
  forwardTransform: ProjectionFunction,
  forwardReproject: ReprojectionFns["forwardReproject"],
  x0: number,
  x1: number,
  height: number,
): [number, number][] {
  const corners: [number, number][] = [
    [x0, 0],
    [x1, 0],
    [x1, height],
    [x0, height],
    [x0, 0],
  ];
  return corners.map(([px, py]) => {
    const [sx, sy] = forwardTransform(px!, py!);
    return forwardReproject(sx, sy);
  });
}

function boxCenter(path: [number, number][]): [number, number] {
  const xs = path.map((p) => p[0]);
  const ys = path.map((p) => p[1]);
  return [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  ];
}

export function renderDebugTileOutline(
  id: string,
  tile: Tile2DHeader & RasterTileMetadata,
  forwardTo4326: ReprojectionFns["forwardReproject"],
) {
  const { _antimeridianCut, _westReprojection, _eastReprojection } = tile;

  // A crossing tile renders as two `RasterLayer`s, each at its own natural
  // common-space position (see `RasterTileLayer._renderAntimeridianTile` and
  // `RasterTileset2D.buildPieceReprojection`) — the debug outline needs to
  // match, using EACH piece's own reprojection, rather than drawing one WGS84
  // box whose corners (e.g. lng 179.97° and −179.17°) `PathLayer` would
  // connect the long way around the globe, or using one piece's reprojection
  // for both (which would place the east box a full world away from where
  // it actually renders).
  if (_antimeridianCut && _westReprojection && _eastReprojection) {
    const { uCut } = _antimeridianCut;
    const { tileWidth, tileHeight, forwardTransform } = tile;
    const cutPx = uCut * tileWidth;
    const westPath = pieceBoxPath(
      forwardTransform,
      _westReprojection.forwardReproject,
      0,
      cutPx,
      tileHeight,
    );
    const eastPath = pieceBoxPath(
      forwardTransform,
      _eastReprojection.forwardReproject,
      cutPx,
      tileWidth,
      tileHeight,
    );

    const labelLayer = new TextLayer({
      id: `${id}-label`,
      data: [
        {
          position: boxCenter(westPath),
          text: `x=${tile.index.x} y=${tile.index.y} z=${tile.index.z} (west)`,
        },
        {
          position: boxCenter(eastPath),
          text: `x=${tile.index.x} y=${tile.index.y} z=${tile.index.z} (east)`,
        },
      ],
      getColor: [255, 255, 255, 255],
      getSize: 24,
      sizeUnits: "pixels",
      outlineWidth: 3,
      outlineColor: [0, 0, 0, 255],
      fontSettings: { sdf: true },
      coordinateSystem: "cartesian",
    });

    const outlineLayer = new PathLayer({
      id,
      data: [westPath, eastPath],
      getPath: (d) => d,
      getColor: [255, 0, 0, 255], // Red
      getWidth: 2,
      widthUnits: "pixels",
      pickable: false,
      coordinateSystem: "cartesian",
    });

    return [outlineLayer, labelLayer];
  }

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
  const topLeftWgs84 = forwardTo4326(topLeft[0], topLeft[1]);
  const topRightWgs84 = forwardTo4326(topRight[0], topRight[1]);
  const bottomRightWgs84 = forwardTo4326(bottomRight[0], bottomRight[1]);
  const bottomLeftWgs84 = forwardTo4326(bottomLeft[0], bottomLeft[1]);

  const path = [
    topLeftWgs84,
    topRightWgs84,
    bottomRightWgs84,
    bottomLeftWgs84,
    topLeftWgs84,
  ];

  const center = [
    (topLeftWgs84[0] + bottomRightWgs84[0]) / 2,
    (topLeftWgs84[1] + bottomRightWgs84[1]) / 2,
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
  });

  return [outlineLayer, labelLayer];
}
