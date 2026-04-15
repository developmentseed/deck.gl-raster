import { describe, expect, it } from "vitest";
import { CutlineBbox } from "../../src/gpu-modules/cutline-bbox.js";

const EARTH_RADIUS = 6378137.0;

function lngLatToMercatorMeters(lng: number, lat: number): [number, number] {
  const x = (EARTH_RADIUS * lng * Math.PI) / 180;
  const y =
    EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

describe("CutlineBbox", () => {
  it("getUniforms converts a WGS84 bbox to EPSG:3857 meters", () => {
    // Abbeville East 7.5' quad, from USGS metadata CSV
    const west = -85.25;
    const south = 31.5;
    const east = -85.125;
    const north = 31.625;

    const [swX, swY] = lngLatToMercatorMeters(west, south);
    const [neX, neY] = lngLatToMercatorMeters(east, north);
    const expectedMinX = Math.min(swX, neX);
    const expectedMinY = Math.min(swY, neY);
    const expectedMaxX = Math.max(swX, neX);
    const expectedMaxY = Math.max(swY, neY);

    const uniforms = CutlineBbox.getUniforms({
      bbox: [west, south, east, north],
    });

    expect(uniforms.bbox).toEqual([
      expectedMinX,
      expectedMinY,
      expectedMaxX,
      expectedMaxY,
    ]);
  });

  it("getUniforms returns an empty object when bbox is not provided", () => {
    expect(CutlineBbox.getUniforms({})).toEqual({});
  });

  it("getUniforms throws when east <= west", () => {
    expect(() => CutlineBbox.getUniforms({ bbox: [10, 0, -10, 1] })).toThrow(
      /east > west/,
    );

    expect(() => CutlineBbox.getUniforms({ bbox: [5, 0, 5, 1] })).toThrow(
      /east > west/,
    );
  });

  it("getUniforms throws when north <= south", () => {
    expect(() => CutlineBbox.getUniforms({ bbox: [-10, 20, 10, 10] })).toThrow(
      /north > south/,
    );

    expect(() => CutlineBbox.getUniforms({ bbox: [-10, 15, 10, 15] })).toThrow(
      /north > south/,
    );
  });

  it("getUniforms throws when latitudes exceed Web Mercator limits", () => {
    expect(() => CutlineBbox.getUniforms({ bbox: [-10, -86, 10, 0] })).toThrow(
      /Web Mercator/,
    );

    expect(() => CutlineBbox.getUniforms({ bbox: [-10, 0, 10, 86] })).toThrow(
      /Web Mercator/,
    );
  });

  it("has the expected module name", () => {
    expect(CutlineBbox.name).toBe("cutlineBbox");
  });

  it("declares a vec4<f32> bbox uniform", () => {
    expect(CutlineBbox.uniformTypes.bbox).toBe("vec4<f32>");
  });

  it("declares the uniform block in fs", () => {
    expect(CutlineBbox.fs).toContain("cutlineBboxUniforms");
    expect(CutlineBbox.fs).toContain("vec4 bbox");
  });

  it("injects a mercator varying write in the vertex shader", () => {
    const vsMainStart = CutlineBbox.inject["vs:#main-start"];
    expect(vsMainStart).toContain("v_cutlineBboxMercator");
    expect(vsMainStart).toContain("positions.xy");
    expect(CutlineBbox.inject["vs:#decl"]).toContain(
      "out vec2 v_cutlineBboxMercator",
    );
    expect(CutlineBbox.inject["fs:#decl"]).toContain(
      "in vec2 v_cutlineBboxMercator",
    );
  });

  it("injects a discard into fs:#main-start", () => {
    const injected = CutlineBbox.inject["fs:#main-start"];
    expect(injected).toContain("v_cutlineBboxMercator");
    expect(injected).toContain("discard");
  });
});
