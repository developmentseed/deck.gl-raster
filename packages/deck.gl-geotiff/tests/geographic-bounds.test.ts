import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import { getGeographicBounds } from "../src/geotiff/geotiff.js";
import { loadGeoTIFF } from "./helpers.js";

const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";
const UTM_60N = "+proj=utm +zone=60 +datum=WGS84 +units=m +no_defs";

/** The geographic bounds of a fixture in `crs`. */
async function boundsOf(name: string, crs: string) {
  const geotiff = await loadGeoTIFF(name, "rasterio");
  const converter = proj4(crs, "EPSG:4326");
  return getGeographicBounds(geotiff, (x, y) => converter.forward([x, y]));
}

describe("getGeographicBounds", () => {
  it("bounds an image across the antimeridian the short way", async () => {
    const { west, east } = await boundsOf("antimeridian_UTM_60N", UTM_60N);
    // From 173.8°E, across 180°, to 172.8°W: written as 187.2°.
    expect(west).toBeCloseTo(173.8, 1);
    expect(east).toBeCloseTo(187.2, 1);
  });

  it("moves an image stored past -180° into the usual range", async () => {
    // Stored from 204°W to 162°W.
    const { west, east } = await boundsOf("antimeridian", WGS84);
    expect(west).toBeCloseTo(156, 9);
    expect(east).toBeCloseTo(198, 9);
  });

  it("keeps an image from 180°W to 180°E the whole world wide", async () => {
    const { west, east } = await boundsOf("antimeridian_edge_to_edge", WGS84);
    expect(west).toBe(-180);
    expect(east).toBe(180);
  });

  it("leaves an image away from the antimeridian as it was", async () => {
    const geotiff = await loadGeoTIFF("cog_uint8_rgba_3857", "rasterio");
    const converter = proj4("EPSG:3857", "EPSG:4326");
    // The extremes of the bounding box's projected corners.
    const [minX, minY, maxX, maxY] = geotiff.bbox;
    const corners = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ].map((corner) => converter.forward(corner));
    const lons = corners.map(([lon]) => lon!);
    const lats = corners.map(([, lat]) => lat!);
    const projectTo4326 = (x: number, y: number) =>
      converter.forward<[number, number]>([x, y]);
    expect(getGeographicBounds(geotiff, projectTo4326)).toEqual({
      west: Math.min(...lons),
      south: Math.min(...lats),
      east: Math.max(...lons),
      north: Math.max(...lats),
    });
  });

  it("bounds all of a rotated image", async () => {
    // Rotated 20°, its corners reach from 204°W to 150.2°W, written as 156° to
    // 209.8°, and from 15.5°S to 38.4°N.
    const { west, south, east, north } = await boundsOf(
      "antimeridian_rotated",
      WGS84,
    );
    expect(west).toBeCloseTo(156, 9);
    expect(east).toBeCloseTo(209.8, 1);
    expect(south).toBeCloseTo(-15.5, 1);
    expect(north).toBeCloseTo(38.4, 1);
  });
});
