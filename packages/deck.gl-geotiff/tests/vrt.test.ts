import { describe, expect, it } from "vitest";
import { parseVRT } from "../src/mosaic-layer/vrt.js";

const VRT_URL = "https://example.com/mosaics/dem.vrt";

const WGS84 = `GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AXIS["Latitude",NORTH],AXIS["Longitude",EAST],AUTHORITY["EPSG","4326"]]`;

const UTM_33N = `PROJCS["WGS 84 / UTM zone 33N",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",15],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","32633"]]`;

/** A `ComplexSource` placed at `dst` (`[xOff, yOff, xSize, ySize]`). */
function source(
  filename: string,
  dst: [number, number, number, number],
  { relativeToVRT = false }: { relativeToVRT?: boolean } = {},
): string {
  const [xOff, yOff, xSize, ySize] = dst;
  return `
    <ComplexSource resampling="bilinear">
      <SourceFilename relativeToVRT="${relativeToVRT ? 1 : 0}">${filename}</SourceFilename>
      <SourceBand>1</SourceBand>
      <SrcRect xOff="0" yOff="0" xSize="${xSize}" ySize="${ySize}" />
      <DstRect xOff="${xOff}" yOff="${yOff}" xSize="${xSize}" ySize="${ySize}" />
      <NODATA>-999999</NODATA>
    </ComplexSource>`;
}

/** A VRT with one band per entry of `bands`, each holding those sources. */
function vrt({
  bands,
  srs = WGS84,
  geoTransform = "-110, 0.25, 0, 45, 0, -0.25",
  datasetAttrs = "",
  bandAttrs = "",
}: {
  bands: string[][];
  srs?: string;
  geoTransform?: string;
  datasetAttrs?: string;
  bandAttrs?: string;
}): string {
  const bandXml = bands
    .map(
      (sources, i) => `
  <VRTRasterBand dataType="Float32" band="${i + 1}" ${bandAttrs}>
    <NoDataValue>-999999</NoDataValue>
    <ColorInterp>Gray</ColorInterp>
    ${sources.join("")}
  </VRTRasterBand>`,
    )
    .join("");
  return `<VRTDataset rasterXSize="40" rasterYSize="40" ${datasetAttrs}>
  <SRS dataAxisToSRSAxisMapping="2,1">${srs}</SRS>
  <GeoTransform>${geoTransform}</GeoTransform>${bandXml}
</VRTDataset>`;
}

describe("parseVRT", () => {
  it("places each file by its DstRect and the VRT's GeoTransform", () => {
    const xml = vrt({
      bands: [
        [source("/vsicurl/https://data.example.com/a.tif", [4, 8, 4, 4])],
      ],
    });
    const [item] = parseVRT(xml, VRT_URL);
    const [west, south, east, north] = item!.bbox;
    expect([west, south, east, north].map((v) => +v.toFixed(9))).toEqual([
      -109, 42, -108, 43,
    ]);
  });

  it("strips the /vsicurl/ prefix from the URL", () => {
    const xml = vrt({
      bands: [
        [source("/vsicurl/https://data.example.com/a.tif", [0, 0, 4, 4])],
      ],
    });
    expect(parseVRT(xml, VRT_URL)[0]!.url).toBe(
      "https://data.example.com/a.tif",
    );
  });

  it("uses the URL as the item id", () => {
    const xml = vrt({
      bands: [[source("https://data.example.com/a.tif", [0, 0, 4, 4])]],
    });
    const [item] = parseVRT(xml, VRT_URL);
    expect(item!.id).toBe(item!.url);
  });

  it("resolves a path relative to the VRT", () => {
    const xml = vrt({
      bands: [[source("tiles/a.tif", [0, 0, 4, 4], { relativeToVRT: true })]],
    });
    expect(parseVRT(xml, VRT_URL)[0]!.url).toBe(
      "https://example.com/mosaics/tiles/a.tif",
    );
  });

  it("keeps the VRT's order of files", () => {
    const xml = vrt({
      bands: [
        [
          source("https://data.example.com/b.tif", [0, 0, 4, 4]),
          source("https://data.example.com/a.tif", [4, 0, 4, 4]),
        ],
      ],
    });
    expect(parseVRT(xml, VRT_URL).map((item) => item.url)).toEqual([
      "https://data.example.com/b.tif",
      "https://data.example.com/a.tif",
    ]);
  });

  it("returns a file listed under several bands once", () => {
    const sources = [
      source("https://data.example.com/a.tif", [0, 0, 4, 4]),
      source("https://data.example.com/b.tif", [4, 0, 4, 4]),
    ];
    const xml = vrt({ bands: [sources, sources, sources] });
    expect(parseVRT(xml, VRT_URL)).toHaveLength(2);
  });

  it("reprojects a projected VRT's bounds to WGS84", () => {
    // x = 500000 m is UTM zone 33N's central meridian, 15°E
    const xml = vrt({
      srs: UTM_33N,
      geoTransform: "500000, 100, 0, 4010000, 0, -100",
      bands: [[source("https://data.example.com/a.tif", [0, 0, 100, 100])]],
    });
    expect(parseVRT(xml, VRT_URL)[0]!.bbox[0]).toBeCloseTo(15, 9);
  });

  it("rejects a source path that isn't a URL", () => {
    const xml = vrt({
      bands: [[source("/vsizip/archive.zip/a.tif", [0, 0, 4, 4])]],
    });
    expect(() => parseVRT(xml, VRT_URL)).toThrow(/vsizip/);
  });

  it("rejects a warped VRT", () => {
    const xml = vrt({
      datasetAttrs: 'subClass="VRTWarpedDataset"',
      bands: [[]],
    });
    expect(() => parseVRT(xml, VRT_URL)).toThrow(/VRTWarpedDataset/);
  });

  it("rejects a derived band", () => {
    const xml = vrt({
      bandAttrs: 'subClass="VRTDerivedRasterBand"',
      bands: [[source("https://data.example.com/a.tif", [0, 0, 4, 4])]],
    });
    expect(() => parseVRT(xml, VRT_URL)).toThrow(/VRTDerivedRasterBand/);
  });

  it("places a file in a rotated VRT", () => {
    // x = -110 + 0.25 * row, y = 45 + 0.25 * col
    const xml = vrt({
      geoTransform: "-110, 0, 0.25, 45, 0.25, 0",
      bands: [[source("https://data.example.com/a.tif", [4, 8, 4, 4])]],
    });
    const [west, south, east, north] = parseVRT(xml, VRT_URL)[0]!.bbox;
    expect([west, south, east, north].map((v) => +v.toFixed(9))).toEqual([
      -108, 46, -107, 47,
    ]);
  });

  it("rejects malformed XML", () => {
    expect(() => parseVRT("<VRTDataset><SRS>", VRT_URL)).toThrow(/XML/);
  });
});
