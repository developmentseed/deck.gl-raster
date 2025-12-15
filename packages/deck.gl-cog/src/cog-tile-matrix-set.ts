import type {
  TileMatrix,
  TileMatrixSet,
} from "@developmentseed/deck.gl-raster";
import type { GeoTIFF, GeoTIFFImage } from "geotiff";
import {
  extractGeotransform,
  getGeoTIFFProjection,
} from "./geotiff-reprojection";
import proj4 from "proj4";

// 0.28 mm per pixel
// https://docs.ogc.org/is/17-083r4/17-083r4.html#toc15
const SCREEN_PIXEL_SIZE = 0.00028;

/**
 *
 * Ported from Vincent's work here:
 * https://github.com/developmentseed/morecantile/pull/187/changes#diff-402eedddfa30af554d03750c8a82a09962b44b044976c321b774b484b98e8f48R665
 *
 * @return  {TileMatrixSet}[return description]
 */
export async function parseCOGTileMatrixSet(
  tiff: GeoTIFF,
): Promise<TileMatrixSet> {
  const fullResImage = await tiff.getImage();
  const imageCount = await tiff.getImageCount();
  const bbox = fullResImage.getBoundingBox();
  const fullImageWidth = fullResImage.getWidth();
  const fullImageHeight = fullResImage.getHeight();

  const crs = await getGeoTIFFProjection(fullResImage);
  if (crs === null) {
    throw new Error(
      "Could not determine coordinate reference system from GeoTIFF geo keys",
    );
  }
  const projectToWgs84 = proj4(crs, "EPSG:4326").forward;
  const projectTo3857 = proj4(crs, "EPSG:3857").forward;

  const boundingBox: TileMatrixSet["boundingBox"] = {
    lowerLeft: [bbox[0]!, bbox[1]!],
    upperRight: [bbox[2]!, bbox[3]!],
  };

  const transform = extractGeotransform(fullResImage);
  const cellSize = Math.abs(transform[0]);

  const tileWidth = fullResImage.getTileWidth();
  const tileHeight = fullResImage.getTileHeight();

  const tileMatrices: TileMatrix[] = [
    {
      // Set as highest resolution / finest level
      id: String(imageCount - 1),
      scaleDenominator: (cellSize * metersPerUnit()) / SCREEN_PIXEL_SIZE,
      cellSize,
      pointOfOrigin: [transform[2], transform[5]],
      tileWidth: fullResImage.getTileWidth(),
      tileHeight: fullResImage.getTileHeight(),
      matrixWidth: Math.ceil(fullImageWidth / tileWidth),
      matrixHeight: Math.ceil(fullImageHeight / tileHeight),
      geotransform: transform,
    },
  ];

  // Starting from 1 to skip full res image
  for (let imageIdx = 1; imageIdx < imageCount - 1; imageIdx++) {
    const image = await tiff.getImage(imageIdx);
    const tileMatrix = createOverviewTileMatrix({
      id: String(imageCount - 1 - imageIdx),
      image,
      fullWidth: fullImageWidth,
      fullHeight: fullImageHeight,
      baseTransform: transform,
    });
    tileMatrices.push(tileMatrix);
  }

  // Reverse to have coarsest level first
  tileMatrices.reverse();

  return {
    crs,
    boundingBox,
    tileMatrices,
    projectToWgs84,
    projectTo3857,
  };
}

/**
 * Coefficient to convert the coordinate reference system (CRS)
 * units into meters (metersPerUnit).
 *
 * From note g in http://docs.opengeospatial.org/is/17-083r2/17-083r2.html#table_2:
 *
 * > If the CRS uses meters as units of measure for the horizontal dimensions,
 * > then metersPerUnit=1; if it has degrees, then metersPerUnit=2pa/360
 * > (a is the Earth maximum radius of the ellipsoid).
 */
// https://github.com/developmentseed/morecantile/blob/7c95a11c491303700d6e33e9c1607f2719584dec/morecantile/utils.py#L67-L90
function metersPerUnit(): number {
  // For now, we assume our projection is in meters
  return 1;
}

/**
 * Create tile matrix for COG overview
 */
function createOverviewTileMatrix({
  id,
  image,
  fullWidth,
  baseTransform,
}: {
  id: string;
  image: GeoTIFFImage;
  fullWidth: number;
  fullHeight: number;
  baseTransform: [number, number, number, number, number, number];
}): TileMatrix {
  const width = image.getWidth();
  const height = image.getHeight();

  const scale = fullWidth / width;
  // assert scale is same for x and y?

  const geotransform: [number, number, number, number, number, number] = [
    baseTransform[0] * scale,
    baseTransform[1] * scale,
    baseTransform[2], // x origin stays the same
    baseTransform[3] * scale,
    baseTransform[4] * scale,
    baseTransform[5], // y origin stays the same
  ];
  const cellSize = Math.abs(geotransform[0]);

  const tileWidth = image.getTileWidth();
  const tileHeight = image.getTileHeight();

  return {
    id,
    scaleDenominator: (cellSize * metersPerUnit()) / SCREEN_PIXEL_SIZE,
    cellSize,
    pointOfOrigin: [geotransform[2], geotransform[5]],
    tileWidth,
    tileHeight,
    matrixWidth: Math.ceil(width / tileWidth),
    matrixHeight: Math.ceil(height / tileHeight),
    geotransform,
  };
}
