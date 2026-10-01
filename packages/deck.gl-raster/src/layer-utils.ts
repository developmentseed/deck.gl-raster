import type { _Tile2DHeader as Tile2DHeader } from "@deck.gl/geo-layers";
import { PathLayer, TextLayer } from "@deck.gl/layers";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import { snapToCopy } from "@developmentseed/raster-reproject";
import type { RasterTileMetadata } from "./raster-tileset/index.js";

// Samples per outline edge; keeps each step well under 180° so a tile
// spanning the whole world (or crossing ±180°) unwraps correctly.
const EDGE_SAMPLES = 16;

export function renderDebugTileOutline(
  id: string,
  tile: Tile2DHeader & RasterTileMetadata,
  forwardTo4326: ReprojectionFns["forwardReproject"],
  /** Pixel size of the tile's data; edge tiles are smaller than nominal. */
  size?: { width: number; height: number } | null,
) {
  // Outline the tile's *data*, not its nominal footprint: an edge tile (e.g. a
  // 72×4 image in a 512×512 tile) would otherwise extend hundreds of degrees
  // past the data.
  //
  // Each edge is sampled in pixel space and unwrapped point-to-point, so a
  // 360°-wide tile draws as a full band instead of collapsing to zero width.
  // `wrapLongitude` then splits the path at ±180°.
  const w = size?.width ?? tile.tileWidth;
  const h = size?.height ?? tile.tileHeight;
  const ring: [number, number][] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
    [0, 0],
  ];
  const path: number[][] = [];
  for (let e = 0; e < 4; e++) {
    const [x0, y0] = ring[e]!;
    const [x1, y1] = ring[e + 1]!;
    for (let i = e === 0 ? 0 : 1; i <= EDGE_SAMPLES; i++) {
      const t = i / EDGE_SAMPLES;
      const [lon, lat] = forwardTo4326(
        ...tile.forwardTransform(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t),
      );
      const prev = path[path.length - 1];
      path.push([prev ? snapToCopy(lon, prev[0]!, 360) : lon, lat]);
    }
  }

  // Label at the middle of the unwrapped tile.
  const center = [
    (path[0]![0]! + path[2 * EDGE_SAMPLES]![0]!) / 2,
    (path[0]![1]! + path[2 * EDGE_SAMPLES]![1]!) / 2,
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
    // Split the outline of a tile crossing ±180° at the antimeridian.
    wrapLongitude: true,
  });

  return [outlineLayer, labelLayer];
}
