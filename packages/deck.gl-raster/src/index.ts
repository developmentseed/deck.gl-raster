export {
  latToMercatorNorm,
  Reproject4326,
} from "./gpu-modules/reproject-4326.js";
export type { RasterModule } from "./gpu-modules/types.js";
export type { RasterLayerProps, SourceCrs } from "./raster-layer.js";
export { RasterLayer } from "./raster-layer.js";
export { RasterTileset2D } from "./raster-tileset/index.js";
export type {
  TileMatrix,
  TileMatrixSet,
  TileMatrixSetBoundingBox,
} from "./raster-tileset/types.js";

import { __TEST_EXPORTS as traversalTestExports } from "./raster-tileset/raster-tile-traversal.js";

export const __TEST_EXPORTS = { ...traversalTestExports };
