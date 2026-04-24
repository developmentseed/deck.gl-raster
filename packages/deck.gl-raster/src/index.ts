export type { RasterModule } from "./gpu-modules/types.js";
// Not a public API; exported for use in COGLayer and ZarrLayer
export { renderDebugTileOutline as _renderDebugTileOutline } from "./layer-utils.js";
export type {
  MultiTilesetDescriptor,
  SecondaryTileIndex,
  SecondaryTileResolution,
  UvTransform,
} from "./multi-raster-tileset/index.js";
export {
  createMultiTilesetDescriptor,
  resolveSecondaryTiles,
  selectSecondaryLevel,
  tilesetLevelsEqual,
} from "./multi-raster-tileset/index.js";
export type { RasterLayerProps, RenderTileResult } from "./raster-layer.js";
export { RasterLayer } from "./raster-layer.js";
export type {
  GetTileDataOptions,
  MinimalTileData,
  RasterTileLayerProps,
} from "./raster-tile-layer/index.js";
export { RasterTileLayer } from "./raster-tile-layer/index.js";
export type {
  Bounds,
  CornerBounds,
  Corners,
  ProjectionFunction,
  TileMetadata,
  TilesetDescriptor,
  TilesetLevel,
} from "./raster-tileset/index.js";
export {
  RasterTileset2D,
  sortByDistanceFromPoint,
  TileMatrixSetAdaptor,
} from "./raster-tileset/index.js";
