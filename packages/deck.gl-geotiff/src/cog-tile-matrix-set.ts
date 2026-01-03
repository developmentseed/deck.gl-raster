import type {
  TileMatrix,
  TileMatrixSet,
  TileMatrixSetBoundingBox,
} from "@developmentseed/deck.gl-raster";
import type { GeoTIFF, GeoTIFFImage } from "geotiff";
import proj4, { type ProjectionDefinition } from "proj4";
import Ellipsoid from "./ellipsoids.js";
import { extractGeotransform } from "./geotiff-reprojection";
import type { GeoKeysParser, ProjectionInfo, SupportedCrsUnit } from "./proj";

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
  geoKeysParser: GeoKeysParser,
): Promise<TileMatrixSet> {
  const fullResImage = await tiff.getImage();

  if (!fullResImage.isTiled) {
    throw new Error("COG TileMatrixSet requires a tiled GeoTIFF");
  }

  const imageCount = await tiff.getImageCount();
  const bbox = fullResImage.getBoundingBox();
  const fullImageWidth = fullResImage.getWidth();
  const fullImageHeight = fullResImage.getHeight();

  const crs = await geoKeysParser(fullResImage.getGeoKeys());

  if (crs === null) {
    throw new Error(
      "Could not determine coordinate reference system from GeoTIFF geo keys",
    );
  }

  const projectToWgs84 = proj4(crs.def, "EPSG:4326").forward;
  const projectTo3857 = proj4(crs.def, "EPSG:3857").forward;

  const boundingBox: TileMatrixSet["boundingBox"] = {
    lowerLeft: [bbox[0]!, bbox[1]!],
    upperRight: [bbox[2]!, bbox[3]!],
  };

  const transform = extractGeotransform(fullResImage);

  if (transform[1] !== 0 || transform[3] !== 0) {
    // TileMatrixSet assumes orthogonal axes
    throw new Error(
      "COG TileMatrixSet with rotation/skewed geotransform is not supported",
    );
  }

  const cellSize = Math.abs(transform[0]);

  const tileWidth = fullResImage.getTileWidth();
  const tileHeight = fullResImage.getTileHeight();

  const tileMatrices: TileMatrix[] = [
    {
      // Set as highest resolution / finest level
      id: String(imageCount - 1),
      scaleDenominator:
        (cellSize * metersPerUnit(crs.parsed, crs.coordinatesUnits)) /
        SCREEN_PIXEL_SIZE,
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
  for (let imageIdx = 1; imageIdx < imageCount; imageIdx++) {
    const image = await tiff.getImage(imageIdx);

    if (!image.isTiled) {
      throw new Error("COG TileMatrixSet requires a tiled GeoTIFF");
    }

    const tileMatrix = createOverviewTileMatrix({
      id: String(imageCount - 1 - imageIdx),
      image,
      fullWidth: fullImageWidth,
      fullHeight: fullImageHeight,
      baseTransform: transform,
      crs,
    });
    tileMatrices.push(tileMatrix);
  }

  // Reverse to have coarsest level first
  tileMatrices.reverse();

  return {
    crs,
    boundingBox,
    wgsBounds: computeWgs84BoundingBox(boundingBox, projectToWgs84),
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
 *
 * If `crsUnit` is provided, it takes precedence over the unit defined in the
 * CRS. This exists because sometimes the parsed CRS from
 * `geotiff-geokeys-to-proj4` doesn't have a unit defined.
 */
// https://github.com/developmentseed/morecantile/blob/7c95a11c491303700d6e33e9c1607f2719584dec/morecantile/utils.py#L67-L90
function metersPerUnit(
  parsedCrs: ProjectionDefinition,
  crsUnit?: SupportedCrsUnit,
): number {
  const unit = crsUnit || parsedCrs.units;
  switch (unit) {
    case "metre":
    case "meter":
    case "meters":
      return 1;
    case "foot":
      return 0.3048;
    case "US survey foot":
      return 1200 / 3937;
  }

  if (unit === "degree") {
    // 2 * π * ellipsoid semi-major-axis / 360
    const { a } = Ellipsoid[parsedCrs.ellps as keyof typeof Ellipsoid];
    return (2 * Math.PI * a) / 360;
  }

  throw new Error(`Unsupported CRS units: ${unit}`);
}

/**
 * Create tile matrix for COG overview
 */
function createOverviewTileMatrix({
  id,
  image,
  fullWidth,
  baseTransform,
  crs,
}: {
  id: string;
  image: GeoTIFFImage;
  fullWidth: number;
  fullHeight: number;
  baseTransform: [number, number, number, number, number, number];
  crs: ProjectionInfo;
}): TileMatrix {
  const width = image.getWidth();
  const height = image.getHeight();

  // For now, just use scaleX
  // https://github.com/developmentseed/morecantile/pull/187/changes#r2621314673
  const scaleX = fullWidth / width;

  // const scaleY = fullHeight / height;
  // if (Math.abs(scaleX - scaleY) > 1e-3) {
  //   throw new Error("Non-uniform overview scaling detected (X/Y differ)");
  // }

  const scale = scaleX;

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
    scaleDenominator:
      (cellSize * metersPerUnit(crs.parsed, crs.coordinatesUnits)) /
      SCREEN_PIXEL_SIZE,
    cellSize,
    pointOfOrigin: [geotransform[2], geotransform[5]],
    tileWidth,
    tileHeight,
    matrixWidth: Math.ceil(width / tileWidth),
    matrixHeight: Math.ceil(height / tileHeight),
    geotransform,
  };
}

function computeWgs84BoundingBox(
  boundingBox: TileMatrixSetBoundingBox,
  projectToWgs84: (point: [number, number]) => [number, number],
): TileMatrixSetBoundingBox {
  const lowerLeftWgs84 = projectToWgs84(boundingBox.lowerLeft);
  const lowerRightWgs84 = projectToWgs84([
    boundingBox.upperRight[0],
    boundingBox.lowerLeft[1],
  ]);
  const upperRightWgs84 = projectToWgs84(boundingBox.upperRight);
  const upperLeftWgs84 = projectToWgs84([
    boundingBox.lowerLeft[0],
    boundingBox.upperRight[1],
  ]);

  // Compute min/max lat/lon
  const minLon = Math.min(
    lowerLeftWgs84[0],
    lowerRightWgs84[0],
    upperRightWgs84[0],
    upperLeftWgs84[0],
  );
  const maxLon = Math.max(
    lowerLeftWgs84[0],
    lowerRightWgs84[0],
    upperRightWgs84[0],
    upperLeftWgs84[0],
  );
  const minLat = Math.min(
    lowerLeftWgs84[1],
    lowerRightWgs84[1],
    upperRightWgs84[1],
    upperLeftWgs84[1],
  );
  const maxLat = Math.max(
    lowerLeftWgs84[1],
    lowerRightWgs84[1],
    upperRightWgs84[1],
    upperLeftWgs84[1],
  );

  return {
    lowerLeft: [minLon, minLat],
    upperRight: [maxLon, maxLat],
  };
}
