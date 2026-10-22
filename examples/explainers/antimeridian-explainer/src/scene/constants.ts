/** The image's file in geotiff-test-data. */
export const FIXTURE_FILE = "antimeridian_UTM_60N.tif";

/**
 * Where the image is read from: geotiff-test-data on GitHub, pinned to the
 * commit that added the file. GitHub serves it with range requests and CORS.
 */
export const FIXTURE_URL = `https://raw.githubusercontent.com/developmentseed/geotiff-test-data/7d46e23/rasterio_generated/fixtures/${FIXTURE_FILE}`;

/** What the story was written for; checked when the file is opened. */
export const IMAGE = {
  width: 42,
  height: 42,
  /** Upper-left corner, in UTM 60N metres. */
  origin: [300000, 6200000] as [number, number],
  /** Pixel size, in metres. */
  pixelSize: 20000,
  /** WGS 84 / UTM zone 60N. */
  epsg: 32660,
};

/** One world's width in deck.gl's common space, where x 0 is -180°. */
export const PERIOD = 512;

/** `RasterLayer`'s default mesh error, in output pixels. */
export const MAX_ERROR = 0.125;
