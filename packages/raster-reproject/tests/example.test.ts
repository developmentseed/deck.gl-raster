import { describe, it } from "vitest";
import { join } from "path";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import {
  RasterReprojector,
  applyAffine,
  invertGeoTransform,
} from "@developmentseed/raster-reproject";
import { readFileSync, writeFileSync } from "fs";
import type { PROJJSONDefinition } from "proj4/dist/lib/core";
import proj4 from "proj4";

const FIXTURES_DIR = join(__dirname, "..", "..", "..", "fixtures");

type FixtureJSON = {
  width: number;
  height: number;
  /** geotransform **may** be in GDAL ordering */
  geotransform: [number, number, number, number, number, number];
  reorderTransform?: boolean;
  projjson?: PROJJSONDefinition;
  wkt2: string;
};

function fromGeoTransform(
  geotransform: [number, number, number, number, number, number],
): {
  pixelToInputCRS: (x: number, y: number) => [number, number];
  inputCRSToPixel: (x: number, y: number) => [number, number];
} {
  const inverseGeotransform = invertGeoTransform(geotransform);
  return {
    pixelToInputCRS: (x: number, y: number) => applyAffine(x, y, geotransform),
    inputCRSToPixel: (x: number, y: number) =>
      applyAffine(x, y, inverseGeotransform),
  };
}

function parseFixture(fixturePath: string): RasterReprojector {
  const {
    width,
    height,
    geotransform,
    reorderTransform,
    projjson,
    wkt2,
  }: FixtureJSON = JSON.parse(readFileSync(fixturePath, "utf-8"));

  let affineGeotransform: [number, number, number, number, number, number] = [
    0, 0, 0, 0, 0, 0,
  ];
  if (reorderTransform === undefined || reorderTransform === true) {
    // Convert GDAL geotransform to affine package geotransform
    affineGeotransform = [
      geotransform[1], // a: pixel width
      geotransform[2], // b: row rotation
      geotransform[0], // c: x origin
      geotransform[4], // d: column rotation
      geotransform[5], // e: pixel height (usually negative)
      geotransform[3], // f: y origin
    ];
  } else {
    affineGeotransform = geotransform;
  }

  const { inputCRSToPixel, pixelToInputCRS } =
    fromGeoTransform(affineGeotransform);
  const converter = proj4(projjson || wkt2, "EPSG:4326");

  const reprojectionFns = {
    pixelToInputCRS,
    inputCRSToPixel,
    forwardReproject: (x: number, y: number) =>
      converter.forward<[number, number]>([x, y], false),
    inverseReproject: (x: number, y: number) =>
      converter.inverse<[number, number]>([x, y], false),
  };
  return new RasterReprojector(reprojectionFns, width, height);
}

function serializeMesh(reprojector: RasterReprojector) {
  const mesh = {
    indices: reprojector.triangles,
    positions: reprojector.exactOutputPositions,
    texCoords: reprojector.uvs,
  };
  return JSON.stringify(mesh);
}

describe("NAIP", () => {
  it("should generate reprojection mesh", () => {
    const baseFname = "m_4007307_sw_18_060_20220803";
    const fixturePath = join(FIXTURES_DIR, `${baseFname}.json`);
    const reprojector = parseFixture(fixturePath);
    reprojector.run(0.125);

    const meshJSON = serializeMesh(reprojector);
    const outputPath = join(FIXTURES_DIR, `${baseFname}.mesh.json`);
    writeFileSync(outputPath, meshJSON);
  });
});

describe("nz-imagery", () => {
  it("should generate reprojection mesh", () => {
    const baseFname = "linz_250-25_GeoTifv1-05";
    const fixturePath = join(FIXTURES_DIR, `${baseFname}.json`);

    console.time(`Create reprojector for ${baseFname}`);
    const reprojector = parseFixture(fixturePath);
    console.timeEnd(`Create reprojector for ${baseFname}`);

    console.time(`Run reprojector for ${baseFname}`);
    reprojector.run(0.125);
    console.timeEnd(`Run reprojector for ${baseFname}`);

    const meshJSON = serializeMesh(reprojector);
    const outputPath = join(FIXTURES_DIR, `${baseFname}.mesh.json`);
    writeFileSync(outputPath, meshJSON);
  });
});

describe("nlcd", () => {
  it("should generate reprojection mesh", () => {
    const baseFname = "Annual_NLCD_LndCov_2023_CU_C1V0";
    const fixturePath = join(FIXTURES_DIR, `${baseFname}.json`);

    console.time(`Create reprojector for ${baseFname}`);
    const reprojector = parseFixture(fixturePath);
    console.timeEnd(`Create reprojector for ${baseFname}`);

    console.time(`Run reprojector for ${baseFname}`);
    reprojector.run(2);
    console.timeEnd(`Run reprojector for ${baseFname}`);

    const meshJSON = serializeMesh(reprojector);
    const outputPath = join(FIXTURES_DIR, `${baseFname}.mesh.json`);
    writeFileSync(outputPath, meshJSON);
  });
});

describe("modis", () => {
  it("should generate reprojection mesh", () => {
    const baseFname = "MYD09A1.A2025169.h10v05.061.2025178160305";
    const fixturePath = join(FIXTURES_DIR, `${baseFname}.json`);

    console.time(`Create reprojector for ${baseFname}`);
    const reprojector = parseFixture(fixturePath);
    console.timeEnd(`Create reprojector for ${baseFname}`);

    console.time(`Run reprojector for ${baseFname}`);
    reprojector.run(0.125);
    console.timeEnd(`Run reprojector for ${baseFname}`);

    const meshJSON = serializeMesh(reprojector);
    const outputPath = join(FIXTURES_DIR, `${baseFname}.mesh.json`);
    writeFileSync(outputPath, meshJSON);
  });
});
