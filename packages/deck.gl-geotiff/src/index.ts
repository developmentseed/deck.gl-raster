export type {
  COGLayerProps,
  GetTileDataOptions,
  MinimalDataT,
} from "./cog-layer.js";
export { COGLayer } from "./cog-layer.js";
export type { TextureDataT } from "./geotiff/render-pipeline.js";
export { inferRenderPipeline } from "./geotiff/render-pipeline.js";
export * as texture from "./geotiff/texture.js";
export type { MosaicLayerProps } from "./mosaic-layer/mosaic-layer.js";
export { MosaicLayer } from "./mosaic-layer/mosaic-layer.js";
export {
  type MosaicSource,
  MosaicTileset2D,
} from "./mosaic-layer/mosaic-tileset-2d";
// Don't export GeoTIFF Layer for now; nudge people towards COGLayer
// export type { GeoTIFFLayerProps } from "./geotiff-layer.js";
// export { GeoTIFFLayer } from "./geotiff-layer.js";
export type {
  MultiCOGLayerProps,
  MultiCOGSourceConfig,
} from "./multi-cog-layer.js";
export { MultiCOGLayer } from "./multi-cog-layer.js";
