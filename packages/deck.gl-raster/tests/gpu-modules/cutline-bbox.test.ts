import { describe, expect, it } from "vitest";
import {
  CutlineBbox,
  lngLatToMercator,
} from "../../src/gpu-modules/cutline-bbox.js";

const EARTH_RADIUS = 6378137.0;

describe("lngLatToMercator", () => {
  it("projects a WGS84 point to EPSG:3857 meters", () => {
    // Emigrant Gap SW corner from USGS metadata CSV.
    const [x, y] = lngLatToMercator(-120.75, 39.25);

    // Textbook mercator forward at R = 6378137.
    const expectedX = (EARTH_RADIUS * -120.75 * Math.PI) / 180;
    const expectedY =
      EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (39.25 * Math.PI) / 360));

    expect(x).toBeCloseTo(expectedX, 6);
    expect(y).toBeCloseTo(expectedY, 6);
  });

  it("maps the equator to y=0", () => {
    const [, y] = lngLatToMercator(0, 0);
    expect(y).toBeCloseTo(0, 6);
  });

  it("maps the prime meridian to x=0", () => {
    const [x] = lngLatToMercator(0, 45);
    expect(x).toBeCloseTo(0, 6);
  });

  it("throws when latitude exceeds the Web Mercator limit", () => {
    expect(() => lngLatToMercator(0, 86)).toThrow(/Web Mercator/);
    expect(() => lngLatToMercator(0, -86)).toThrow(/Web Mercator/);
  });
});

describe("CutlineBbox", () => {
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

  it("getUniforms passes the bbox through unchanged", () => {
    const mercatorBbox: [number, number, number, number] = [
      -1_000_000, 2_000_000, 3_000_000, 4_000_000,
    ];
    const uniforms = CutlineBbox.getUniforms({ bbox: mercatorBbox });
    expect(uniforms.bbox).toBe(mercatorBbox);
  });

  it("getUniforms returns an empty object when bbox is not provided", () => {
    expect(CutlineBbox.getUniforms({})).toEqual({});
  });
});
