import type {
  AffineTilesetLevelOptions,
  Corners,
  UvTransform,
} from "@developmentseed/deck.gl-raster";
import {
  AffineTilesetLevel,
  resolveSecondaryTiles,
  selectSecondaryLevel,
} from "@developmentseed/deck.gl-raster";
import type { BandId } from "./constants.js";
import { BANDS, SCENE_ORIGIN, STORY_TILE } from "./constants.js";

/** The parts of a GeoTIFF image that define its tile grid. */
export type ImageGeometry = {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  transform: AffineTilesetLevelOptions["affine"];
};

/** How one band covers the story tile. */
export type StoryBand = {
  /** The band's tiles that cover the story tile, row by row. */
  tiles: { x: number; y: number }[];
  /** Width of the stitched texture, in pixels. */
  stitchedWidth: number;
  /** Height of the stitched texture, in pixels. */
  stitchedHeight: number;
  /** Where the story tile sits in the stitched texture. */
  uvTransform: UvTransform;
  /** Column of the first covering tile. */
  minCol: number;
  /** Row of the first covering tile. */
  minRow: number;
};

/** The story tile, and how each band covers it. */
export type StoryTile = {
  /** The tile's corners in UTM metres. */
  primaryCorners: Corners;
  /** How each band covers the tile. */
  bands: Record<BandId, StoryBand>;
};

/**
 * The full-resolution tile grid of one band, as `MultiCOGLayer` builds it.
 * Without `image`, the grid comes from the expected values in `BANDS`.
 */
export function levelFor(
  band: BandId,
  image?: ImageGeometry,
): AffineTilesetLevel {
  const spec = BANDS[band];
  const geometry: ImageGeometry = image ?? {
    width: spec.size,
    height: spec.size,
    tileWidth: spec.block,
    tileHeight: spec.block,
    transform: [
      spec.pixelSize,
      0,
      SCENE_ORIGIN[0],
      0,
      -spec.pixelSize,
      SCENE_ORIGIN[1],
    ],
  };
  return new AffineTilesetLevel({
    affine: geometry.transform,
    arrayWidth: geometry.width,
    arrayHeight: geometry.height,
    tileWidth: geometry.tileWidth,
    tileHeight: geometry.tileHeight,
    mpu: 1,
  });
}

/**
 * Resolve how each band covers the story tile, with the functions
 * `MultiCOGLayer` calls: the 10 m band is the primary grid, and the other two
 * are resolved with `selectSecondaryLevel` and `resolveSecondaryTiles`.
 */
export function resolveStoryTile(
  levels: Record<BandId, AffineTilesetLevel>,
): StoryTile {
  const primary = levels.b04;
  const { x, y } = STORY_TILE;
  const secondary = (band: "b11" | "b01"): StoryBand => {
    const level = selectSecondaryLevel([levels[band]], primary.metersPerPixel);
    const resolution = resolveSecondaryTiles(primary, x, y, level, 0);
    return {
      tiles: resolution.tileIndices,
      stitchedWidth: resolution.stitchedWidth,
      stitchedHeight: resolution.stitchedHeight,
      uvTransform: resolution.uvTransform,
      minCol: resolution.minCol,
      minRow: resolution.minRow,
    };
  };
  return {
    primaryCorners: primary.projectedTileCorners(x, y),
    bands: {
      b04: {
        tiles: [{ x, y }],
        stitchedWidth: primary.tileWidth,
        stitchedHeight: primary.tileHeight,
        uvTransform: [0, 0, 1, 1],
        minCol: x,
        minRow: y,
      },
      b11: secondary("b11"),
      b01: secondary("b01"),
    },
  };
}
