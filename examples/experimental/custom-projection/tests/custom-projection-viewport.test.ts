import { WebMercatorViewport } from "@deck.gl/core";
import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import {
  CustomProjectionView,
  CustomProjectionViewport,
  NORMALIZATION_SCALE,
  pixelToWorld,
  resolveCRS,
} from "../src/custom-projection/index.js";

const ARCTIC =
  "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
const ANTARCTIC =
  "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
const EQUAL_EARTH =
  "+proj=eqearth +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";

const ARCTIC_CRS = await resolveCRS(ARCTIC);
const ANTARCTIC_CRS = await resolveCRS(ANTARCTIC);
const EQUAL_EARTH_CRS = await resolveCRS(EQUAL_EARTH);
const WEB_MERCATOR_CRS = await resolveCRS("EPSG:3857");

function arcticViewport(
  options: Partial<
    ConstructorParameters<typeof CustomProjectionViewport>[0]
  > = {},
) {
  return new CustomProjectionViewport({
    crs: ARCTIC_CRS,
    width: 800,
    height: 600,
    center: [-45, 75, 0],
    zoom: 3,
    ...options,
  });
}

describe("CustomProjectionViewport", () => {
  it("places the camera at the projected center", () => {
    const viewport = arcticViewport();
    const [x, y] = proj4("EPSG:4326", ARCTIC).forward([-45, 75]);
    expect(viewport.target[0]).toBeCloseTo(x!, 6);
    expect(viewport.target[1]).toBeCloseTo(y!, 6);
    // The projected center lands in the middle of the screen.
    const pixel = viewport.project([x!, y!]);
    expect(pixel[0]).toBeCloseTo(400, 6);
    expect(pixel[1]).toBeCloseTo(300, 6);
  });

  it("prefers target over center", () => {
    const viewport = arcticViewport({ target: [1000, 2000, 0] });
    expect(viewport.target).toEqual([1000, 2000, 0]);
  });

  it("uses upstream's map-meter to common scale, so zoom matches MapView", () => {
    const viewport = arcticViewport({ zoom: 5 });
    expect(viewport.projectFlat([1, 2])).toEqual([
      NORMALIZATION_SCALE,
      2 * NORMALIZATION_SCALE,
    ]);
    // 2^zoom CSS pixels per common unit, like WebMercatorViewport.
    expect(viewport.scale).toBe(32);
    expect(viewport.metersPerPixel).toBeCloseTo(1 / (32 * NORMALIZATION_SCALE));
  });

  it("matches WebMercatorViewport pixels for EPSG:3857", () => {
    const zoom = 4;
    const custom = new CustomProjectionViewport({
      crs: WEB_MERCATOR_CRS,
      width: 800,
      height: 600,
      center: [10, 50, 0],
      zoom,
    });
    const mercator = new WebMercatorViewport({
      width: 800,
      height: 600,
      longitude: 10,
      latitude: 50,
      zoom,
    });
    for (const [lng, lat] of [
      [10, 50],
      [12.5, 51],
      [7, 48.2],
    ]) {
      const expected = mercator.project([lng!, lat!]);
      const mapMeters = WEB_MERCATOR_CRS.converter.WGS84.from([lng!, lat!, 0]);
      const actual = custom.project(mapMeters.slice(0, 2));
      expect(actual[0]).toBeCloseTo(expected[0]!, 3);
      expect(actual[1]).toBeCloseTo(expected[1]!, 3);
    }
  });

  it("clamps the camera center to the rendering extent", () => {
    // math.gl caps north polar stereographic 150° from the pole, at 60°S.
    const clamped = arcticViewport({ center: [20, -80, 0] }).target;
    const edge = arcticViewport({ center: [20, -60, 0] }).target;
    expect(clamped[0]).toBeCloseTo(edge[0]!, 3);
    expect(clamped[1]).toBeCloseTo(edge[1]!, 3);
  });

  it("falls back to the origin for an unprojectable center", () => {
    const viewport = arcticViewport({ center: [Number.NaN, 0, 0] });
    expect(viewport.target).toEqual([0, 0, 0]);
  });

  it("converts pixels to world coordinates", () => {
    const viewport = arcticViewport();
    const world = pixelToWorld(viewport, [400, 300]);
    expect(world?.[0]).toBeCloseTo(-45, 6);
    expect(world?.[1]).toBeCloseTo(75, 6);
  });

  it("returns null for pixels whose inverse throws", () => {
    // At zoom 0 a pixel is about 78 km, so 290 px above the center is about
    // 22,700 km north: past Equal Earth's top edge (about 8,390 km), where
    // its inverse throws.
    const viewport = new CustomProjectionViewport({
      crs: EQUAL_EARTH_CRS,
      width: 800,
      height: 600,
      center: [0, 0, 0],
      zoom: 0,
    });
    expect(pixelToWorld(viewport, [400, 10])).toBeNull();
  });

  it("signs projections with the CRS signature and resolution", () => {
    expect(arcticViewport().projectionSignature).toBe(
      JSON.stringify([ARCTIC, 0]),
    );
    expect(arcticViewport({ resolution: 36 }).projectionSignature).toBe(
      JSON.stringify([ARCTIC, 36]),
    );
  });

  it("treats viewports with different projections as unequal", () => {
    // Same camera, so only the projection differs.
    const a = arcticViewport({ target: [0, 0, 0] });
    const b = arcticViewport({ target: [0, 0, 0] });
    const c = new CustomProjectionViewport({
      crs: ANTARCTIC_CRS,
      width: 800,
      height: 600,
      target: [0, 0, 0],
      zoom: 3,
    });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it("prefers zoomX over a stale zoom while the controller applies an anchor", () => {
    const viewport = arcticViewport({ zoom: 2, zoomX: 4, zoomY: 4 });
    expect(viewport.zoom).toBe(4);
    expect(viewport.scale).toBe(16);
  });

  it("rejects a CRS without linear axes", async () => {
    const wgs84 = await resolveCRS("EPSG:4326");
    expect(
      () =>
        new CustomProjectionViewport({ crs: wgs84, width: 800, height: 600 }),
    ).toThrow("linear CRS axes");
  });
});

describe("CustomProjectionView", () => {
  it("makes no viewport until initialize() resolves the CRS", async () => {
    // Not resolved anywhere else in this file, so not cached yet.
    const crs =
      "+proj=eqearth +lon_0=10 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
    const view = new CustomProjectionView({ id: "map", crs });
    const options = {
      width: 800,
      height: 600,
      viewState: { center: [10, 0, 0], zoom: 1 },
    } as never;
    expect(view.makeViewport(options)).toBeNull();
    await view.initialize();
    const viewport = view.makeViewport(options) as CustomProjectionViewport;
    expect(viewport.crs.signature).toBe(crs);
  });

  it("rejects a geographic CRS in initialize()", async () => {
    const view = new CustomProjectionView({ id: "map", crs: "EPSG:4326" });
    await expect((async () => view.initialize())()).rejects.toThrow(
      "projected CRS",
    );
  });
});
