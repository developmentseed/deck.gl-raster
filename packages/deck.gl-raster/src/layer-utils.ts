import type { _Tile2DHeader as Tile2DHeader } from "@deck.gl/geo-layers";
import { PathLayer, TextLayer } from "@deck.gl/layers";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { TileMetadata } from "./raster-tileset/index.js";

export function renderDebugTileOutline(
  id: string,
  tile: Tile2DHeader & TileMetadata,
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
