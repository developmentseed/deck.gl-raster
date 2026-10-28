import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import { parseWkt, projectionFunctions } from "../src/index.js";

const WGS84 =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],' +
  'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]';

const UTM_60N =
  `PROJCS["WGS 84 / UTM zone 60N",${WGS84},` +
  'PROJECTION["Transverse_Mercator"],' +
  'PARAMETER["latitude_of_origin",0],' +
  'PARAMETER["central_meridian",177],' +
  'PARAMETER["scale_factor",0.9996],' +
  'PARAMETER["false_easting",500000],' +
  'PARAMETER["false_northing",0],' +
  'UNIT["metre",1]]';

describe("projectionFunctions", () => {
  it("projects to WGS84 and back", () => {
    const { projectTo4326, projectFrom4326 } = projectionFunctions(
      parseWkt(UTM_60N),
    );

    const [lon, lat] = projectTo4326(500000, 4000000);
    const [x, y] = projectFrom4326(lon, lat);

    // The zone's central meridian
    expect(lon).toBeCloseTo(177, 9);
    expect(x).toBeCloseTo(500000, 6);
    expect(y).toBeCloseTo(4000000, 6);
  });

  it("projects to Web Mercator as proj4 does", () => {
    const { projectTo3857 } = projectionFunctions(parseWkt(WGS84));
    const expected = proj4("EPSG:4326", "EPSG:3857").forward([10, 20]);

    const [x, y] = projectTo3857(10, 20);

    expect(x).toBeCloseTo(expected[0]!, 6);
    expect(y).toBeCloseTo(expected[1]!, 6);
  });

  it("gives the meters per unit of the CRS", () => {
    expect(projectionFunctions(parseWkt(UTM_60N)).mpu).toBe(1);
    // A degree of longitude at the equator
    expect(projectionFunctions(parseWkt(WGS84)).mpu).toBeCloseTo(
      (2 * Math.PI * 6378137) / 360,
      6,
    );
  });

  it("rejects a projection without units", () => {
    const projection = { ...parseWkt(UTM_60N), units: undefined };

    expect(() => projectionFunctions(projection)).toThrow(/missing 'units'/);
  });
});
