import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import proj4 from "proj4";
import { beforeAll, describe, expect, it, vi } from "vitest";
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

    const converter = proj4(wkt4326, wkt3857);
    // London: lon=-0.1276, lat=51.5074
    const [x, y] = converter.forward([-0.1276, 51.5074]);

    // Expected Web Mercator coords (metres), tolerance of 100m
    expect(x).toBeCloseTo(-14209, -2);
    expect(y).toBeCloseTo(6678078, -2);
  });
});
