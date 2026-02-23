import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import proj4 from "proj4";
import { describe, expect, it, vi } from "vitest";
import loadEPSG from "../src/all.js";

// Node's fetch does not support file:// URLs, so we stub it to read from disk.
const csvGzPath = resolve(import.meta.dirname, "../src/epsg.csv.gz");
vi.stubGlobal("fetch", async () => new Response(readFileSync(csvGzPath)));

describe("loadEPSG", async () => {
  const epsg = await loadEPSG();

  it("loads all EPSG entries", () => {
    expect(epsg.size).toEqual(7352);
  });

  it("returns WKT string for EPSG:4326", () => {
    const wkt = epsg.get(4326);
    expect(wkt).toBeDefined();
    expect(wkt).toContain("WGS");
  });

  it("can use WKT to project from EPSG:4326 to EPSG:3857", () => {
    const wkt4326 = epsg.get(4326)!;
    const wkt3857 = epsg.get(3857)!;
    expect(wkt4326).toBeDefined();
    expect(wkt3857).toBeDefined();

    // Python code used to generate expected values:
    // import pyproj
    // from pyproj import CRS

    // epsg_4326 = CRS.from_epsg(4326)
    // epsg_3857 = CRS.from_epsg(3857)
    // transformer = pyproj.Transformer.from_crs(epsg_4326, epsg_3857, always_xy=True)
    // transformer.transform(1, 52)
    // (111319.49079327357, 6800125.454397307)

    const converter = proj4(wkt4326, wkt3857);
    const source = [1, 52];
    const [x, y] = converter.forward(source);

    // Expected Web Mercator coords (metres), tolerance of 100m
    expect(x).toBeCloseTo(111319.49079327357, 2);
    expect(y).toBeCloseTo(6800125.454397307, 2);
  });
});
