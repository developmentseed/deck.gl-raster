/**
 * Simple shim that implements the loaders.gl interface so that the user can
 * pass a string into the data prop.
 */
import type { Loader, LoaderWithParser } from "@loaders.gl/core";
import type { Source } from "@loaders.gl/loader-utils";
import type { GeoTIFF } from "geotiff";

/* ASCII I */
const I = 0x49;

/* ASCII M */
const M = 0x4d;

export const GeoTIFFLoader: LoaderWithParser<string> = {
  id: "geotiff",
  name: "GeoTIFF",
  module: "geotiff",
  version: "version",
  worker: false,
  extensions: ["tif", "tiff", "geotiff"],
  mimeTypes: ["image/tiff", "image/geotiff"],
  parse: async (arrayBuffer: ArrayBuffer): Promise<GeoTIFF> => {
    console.log("parsing geotiff");
    console.log(arrayBuffer);
  },
  // binary: false,
  // text: true,
  // tests: [testTIFFMagic],
  // options: {
  //   fetch: (input, info) => input,
  //   geotiff: {
  //     fetch: (input, init) => {
  //       return input;
  //     },
  //   },
  // },
  // parseTextSync: (text: string) => text,
};

// function parseGeoTIFF(arrayBuffer: ArrayBuffer): Promise<GeoTIFF> {

// }

/**
 * Test for TIFF magic bytes
 *
 * Magic bytes are either `II` or `MM` indicating little or big endian. Then the
 * following bytes should be 42 for TIFF or 43 for BigTIFF.
 */
function testTIFFMagic(arrayBuffer: ArrayBuffer): boolean {
  const byteArray = new Uint8Array(arrayBuffer);

  const b0 = byteArray[0];
  const b1 = byteArray[1];

  // "II" = little endian, "MM" = big endian
  const isLittleEndian = b0 === I && b1 === I;
  const isBigEndian = b0 === M && b1 === M;

  if (!isLittleEndian && !isBigEndian) {
    return false;
  }

  const dataView = new DataView(arrayBuffer);

  // 42 for classic TIFF, 43 for BigTIFF
  const tiffVersion = dataView.getUint16(2, isLittleEndian);

  return tiffVersion === 42 || tiffVersion === 43;
}
