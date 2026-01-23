export type { COGLayerProps } from "./cog-layer.js";
export { COGLayer } from "./cog-layer.js";
export { parseCOGTileMatrixSet } from "./cog-tile-matrix-set.js";
export { loadRgbImage, parseColormap } from "./geotiff/geotiff.js";
export * as texture from "./geotiff/texture.js";
export type { GeoTIFFLayerProps } from "./geotiff-layer.js";
export { GeoTIFFLayer } from "./geotiff-layer.js";
export {
  extractGeotiffReprojectors,
  fromGeoTransform,
} from "./geotiff-reprojection.js";
export type { MosaicLayerProps } from "./mosaic-layer/mosaic-layer.js";
export { MosaicLayer } from "./mosaic-layer/mosaic-layer.js";
export {
  type MosaicSource,
  MosaicTileset2D,
} from "./mosaic-layer/mosaic-tileset-2d";
export * as proj from "./proj.js";

import { __TEST_EXPORTS as cogTileMatrixSetTestExports } from "./cog-tile-matrix-set.js";

export const __TEST_EXPORTS = { ...cogTileMatrixSetTestExports };
