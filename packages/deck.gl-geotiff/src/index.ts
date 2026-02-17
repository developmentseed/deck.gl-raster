export type { COGLayerProps } from "./cog-layer.js";
export { COGLayer } from "./cog-layer.js";
export { parseColormap } from "./geotiff/geotiff.js";
export * as texture from "./geotiff/texture.js";
// Don't export GeoTIFF Layer for now; nudge people towards COGLayer
// export type { GeoTIFFLayerProps } from "./geotiff-layer.js";
// export { GeoTIFFLayer } from "./geotiff-layer.js";
export { extractGeotiffReprojectors } from "./geotiff-reprojection.js";
export type { MosaicLayerProps } from "./mosaic-layer/mosaic-layer.js";
export { MosaicLayer } from "./mosaic-layer/mosaic-layer.js";
export {
  type MosaicSource,
  MosaicTileset2D,
} from "./mosaic-layer/mosaic-tileset-2d";
export * as proj from "./proj.js";
