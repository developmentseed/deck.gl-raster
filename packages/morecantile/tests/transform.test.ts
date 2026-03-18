import { describe, expect, it } from "vitest";
// ---------------------------------------------------------------------------
// Fixture helpers — pull zoom levels out of the bundled OGC example files.
// ---------------------------------------------------------------------------
import _CDB1 from "../spec/schemas/tms/2.0/json/examples/tilematrixset/CDB1GlobalGrid.json";
import _GNOSIS from "../spec/schemas/tms/2.0/json/examples/tilematrixset/GNOSISGlobalGrid.json";
import _UTM31 from "../spec/schemas/tms/2.0/json/examples/tilematrixset/UTM31WGS84Quad.json";
import _WebMercator from "../spec/schemas/tms/2.0/json/examples/tilematrixset/WebMercatorQuad.json";
import _WorldCRS84 from "../spec/schemas/tms/2.0/json/examples/tilematrixset/WorldCRS84Quad.json";
import { matrixTransform, tileTransform } from "../src/transform";
import type { TileMatrix, TileMatrixSet } from "../src/types/index";

const CDB1 = _CDB1 as TileMatrixSet;
const GNOSIS = _GNOSIS as TileMatrixSet;
const UTM31 = _UTM31 as TileMatrixSet;
const WebMercator = _WebMercator as TileMatrixSet;
const WorldCRS84 = _WorldCRS84 as TileMatrixSet;

function findMatrix(tms: TileMatrixSet, id: string): TileMatrix {
  const m = tms.tileMatrices.find((m) => m.id === id);
  if (!m) throw new Error(`no matrix with id "${id}"`);
  return m;
}

// ---------------------------------------------------------------------------
// matrixTransform — uniform grids
// ---------------------------------------------------------------------------
describe("matrixTransform", () => {
  it("returns the correct affine for WebMercatorQuad zoom 0", () => {
    const m = findMatrix(WebMercator, "0");
    expect(matrixTransform(m)).toEqual([
      156543.033928041, 0, -20037508.3427892, 0, -156543.033928041,
      20037508.3427892,
    ]);
  });

  it("returns the correct affine for WorldCRS84Quad zoom 0", () => {
    const m = findMatrix(WorldCRS84, "0");
    expect(matrixTransform(m)).toEqual([0.703125, 0, -180, 0, -0.703125, 90]);
  });

  it("returns the correct affine for UTM31WGS84Quad zoom 2", () => {
    const m = findMatrix(UTM31, "2");
    expect(matrixTransform(m)).toEqual([
      39070.178630128, 0, -9501965.72931276, 0, -39070.178630128,
      20003931.4586255,
    ]);
  });

  it("returns null when variableMatrixWidths is present", () => {
    const m = findMatrix(GNOSIS, "1");
    expect(matrixTransform(m)).toBeNull();
  });

  it("returns null for CDB1GlobalGrid zoom -10 (heavy VMW)", () => {
    const m = findMatrix(CDB1, "-10");
    expect(matrixTransform(m)).toBeNull();
  });

  it("returns a valid affine when VMW array is absent entirely", () => {
    const m = findMatrix(GNOSIS, "0");
    expect(matrixTransform(m)).not.toBeNull();
  });

  it("flips Y sign for a bottomLeft origin", () => {
    const m: TileMatrix = {
      id: "synthetic",
      scaleDenominator: 1,
      cellSize: 1,
      cornerOfOrigin: "bottomLeft",
      pointOfOrigin: [0, 0],
      tileWidth: 10,
      tileHeight: 10,
      matrixWidth: 4,
      matrixHeight: 4,
    };
    expect(matrixTransform(m)).toEqual([1, 0, 0, 0, 1, 0]);
  });
});

// ---------------------------------------------------------------------------
// tileTransform — uniform grids (coalesce = 1 everywhere)
// ---------------------------------------------------------------------------
describe("tileTransform — uniform grids", () => {
  it("tile (0,0) of WebMercatorQuad z0 matches matrixTransform origin", () => {
    const m = findMatrix(WebMercator, "0");
    expect(tileTransform(m, { col: 0, row: 0 })).toEqual([
      156543.033928041, 0, -20037508.3427892, 0, -156543.033928041,
      20037508.3427892,
    ]);
  });

  it("tile (1,0) of WorldCRS84Quad z0 has origin shifted by one tileSpanX", () => {
    const m = findMatrix(WorldCRS84, "0");
    // tileSpanX = 0.703125 * 256 = 180
    expect(tileTransform(m, { col: 1, row: 0 })).toEqual([
      0.703125, 0, 0, 0, -0.703125, 90,
    ]);
  });

  it("pixel (255,255) of tile (0,0) in WebMercatorQuad z0 maps correctly", () => {
    const m = findMatrix(WebMercator, "0");
    const [a, , c, , e, f] = tileTransform(m, { col: 0, row: 0 });
    const x = a * 255 + c;
    const y = e * 255 + f;
    expect(x).toBeCloseTo(19880965.308861252);
    expect(y).toBeCloseTo(-19880965.308861252);
  });

  it("UTM31 zoom 2 tile (1,2): origin lands on false easting and near zero northing", () => {
    const m = findMatrix(UTM31, "2");
    const t = tileTransform(m, { col: 1, row: 2 });
    expect(t[0]).toBe(39070.178630128); // cellSize, unchanged
    expect(t[2]).toBeCloseTo(500000); // UTM zone 31 false easting
    expect(t[4]).toBe(-39070.178630128); // -cellSize
    expect(t[5]).toBeCloseTo(0, 5); // two tileSpans down from origin ≈ 0
  });

  it("bottomLeft synthetic: tile (2,3) origin is at (20, 30)", () => {
    const m: TileMatrix = {
      id: "synthetic",
      scaleDenominator: 1,
      cellSize: 1,
      cornerOfOrigin: "bottomLeft",
      pointOfOrigin: [0, 0],
      tileWidth: 10,
      tileHeight: 10,
      matrixWidth: 8,
      matrixHeight: 8,
    };
    expect(tileTransform(m, { col: 2, row: 3 })).toEqual([1, 0, 20, 0, 1, 30]);
  });
});

// ---------------------------------------------------------------------------
// tileTransform — coalesced grids (variableMatrixWidths)
// ---------------------------------------------------------------------------
describe("tileTransform — coalesced grids", () => {
  it("GNOSISGlobalGrid z1 row 0 (coalesce=2): X pixel size is doubled", () => {
    const m = findMatrix(GNOSIS, "1");
    const t = tileTransform(m, { col: 0, row: 0 });
    expect(t[0]).toBe(0.3515625); // 2 * 0.17578125
    expect(t[2]).toBe(90); // col 0 → no X shift from origin
  });

  it("GNOSISGlobalGrid z1 row 1 (no coalesce): full affine is normal", () => {
    const m = findMatrix(GNOSIS, "1");
    // row 1 is not in any VMW range → coalesce = 1
    // col 2: originX = 90 + 2*(1*0.17578125*256) = 90 + 90 = 180
    // row 1: originY = -180 + (-1)*1*(0.17578125*256) = -180 - 45 = -225
    expect(tileTransform(m, { col: 2, row: 1 })).toEqual([
      0.17578125, 0, 180, 0, -0.17578125, -225,
    ]);
  });

  it("GNOSISGlobalGrid z1 row 3 (coalesce=2): Y origin still steps by normal tileSpanY", () => {
    const m = findMatrix(GNOSIS, "1");
    const t = tileTransform(m, { col: 0, row: 3 });
    expect(t[0]).toBe(0.3515625); // X stretched
    // Y origin: -180 + (-1)*3*(0.17578125*256) = -180 - 135 = -315
    expect(t[5]).toBe(-315);
  });

  it("CDB1GlobalGrid z-10 row 0 (coalesce=12): full affine", () => {
    const m = findMatrix(CDB1, "-10");
    expect(tileTransform(m, { col: 0, row: 0 })).toEqual([
      12, 0, 90, 0, -1, -180,
    ]);
  });

  it("CDB1GlobalGrid z-10 row 50 (no coalesce entry): coalesce defaults to 1", () => {
    const m = findMatrix(CDB1, "-10");
    // rows 40–139 have no VMW entry
    // col 5: originX = 90 + 5*(1*1*1) = 95
    // row 50: originY = -180 + (-1)*50*(1*1) = -230
    expect(tileTransform(m, { col: 5, row: 50 })).toEqual([
      1, 0, 95, 0, -1, -230,
    ]);
  });

  it("CDB1GlobalGrid z-10 row 170 (coalesce=6): X stretched, Y unaffected", () => {
    const m = findMatrix(CDB1, "-10");
    const t = tileTransform(m, { col: 0, row: 170 });
    expect(t[0]).toBe(6); // 6 * cellSize(1)
    expect(t[2]).toBe(90); // col 0 → no X shift
    expect(t[4]).toBe(-1); // Y pixel size unchanged
    expect(t[5]).toBe(-350); // -180 + (-1)*170*1
  });
});
