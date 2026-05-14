export type { RasterModule } from "./gpu-modules/types.js";
// Not a public API; exported for use in COGLayer and ZarrLayer
export { renderDebugTileOutline as _renderDebugTileOutline } from "./layer-utils.js";
export type {
  MultiRasterTilesetDescriptor,
  SecondaryTileIndex,
  SecondaryTileResolution,
  UvTransform,
} from "./multi-raster-tileset/index.js";
export {
  createMultiRasterTilesetDescriptor,
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
  AffineTilesetLevelOptions,
  AffineTilesetOptions,
  Bounds,
  CornerBounds,
  Corners,
  ProjectionFunction,
  RasterTileMetadata,
  RasterTilesetDescriptor,
  RasterTilesetLevel,
} from "./raster-tileset/index.js";
export {
  AffineTileset,
  AffineTilesetLevel,
  RasterTileset2D,
  // Not a public export, but we want to share across modules
  sortByDistanceFromPoint as _sortByDistanceFromPoint,
  TileMatrixSetAdaptor,
} from "./raster-tileset/index.js";
