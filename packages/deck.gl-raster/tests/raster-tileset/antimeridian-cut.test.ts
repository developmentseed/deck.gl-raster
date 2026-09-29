import { describe, expect, it } from "vitest";
import type { AntimeridianCut } from "../../src/raster-tileset/antimeridian-cut.js";
import {
  antimeridianCut,
  unwrapCommonSpaceX,
  unwrapEastLng,
} from "../../src/raster-tileset/antimeridian-cut.js";

// cornerLngs are WGS84 longitudes as returned by
// descriptor.projectTo4326(corner)[0]. Two encodings are accepted for a
// crossing edge — see CornerLongitudes' doc:
//  - native un-normalized (identity 4326→4326 source): west < east always,
//    e.g. (−204, −162).
//  - GeoJSON-flipped (RFC 7946 §5.2 — what a projected source emits, since
//    proj4's inverse projection normalizes to (−180°, 180°]): west > east,
//    e.g. (179.97, −179.17).
describe("antimeridianCut", () => {
  it("returns undefined for a non-crossing tile (west < east, no seam inside)", () => {
    expect(
      antimeridianCut({
        topLeft: 10,
        topRight: 20,
        bottomLeft: 10,
        bottomRight: 20,
      }),
    ).toBeUndefined();
  });

  it("locates a vertical cut for an axis-aligned crossing tile (native un-normalized lngs)", () => {
    // antimeridian.tif: ModelTiepoint origin lng −204°, east edge −162°.
    const cut = antimeridianCut({
      topLeft: -204,
      topRight: -162,
      bottomLeft: -204,
      bottomRight: -162,
    });
    expect(cut).toBeDefined();
    // The −180° seam is at (−180 − (−204)) / (−162 − (−204)) = 24/42 of the
    // edge span.
    expect(cut?.uCut).toBeCloseTo(24 / 42, 9);
  });

  it("locates the cut equivalently for an in-range crossing span (170, 190)", () => {
    const cut = antimeridianCut({
      topLeft: 170,
      topRight: 190,
      bottomLeft: 170,
      bottomRight: 190,
    });
    expect(cut?.uCut).toBeCloseTo(0.5, 9);
  });

  it("returns undefined for a slanted (non-vertical) crossing cut", () => {
    // Top edge crosses at u = 24/42 ≈ 0.571; bottom edge at u = 10/40 = 0.25.
    expect(
      antimeridianCut({
        topLeft: -204,
        topRight: -162,
        bottomLeft: -190,
        bottomRight: -150,
      }),
    ).toBeUndefined();
  });

  it("returns undefined when a corner lies exactly on the antimeridian (boundary, non-crossing)", () => {
    // Strict-inequality seam-finding treats edges that *touch* ±180 as
    // non-crossing (the seam is not strictly interior), avoiding a degenerate
    // uCut of 0 or 1.
    expect(
      antimeridianCut({
        topLeft: 160,
        topRight: 180,
        bottomLeft: 160,
        bottomRight: 180,
      }),
    ).toBeUndefined();
    expect(
      antimeridianCut({
        topLeft: -180,
        topRight: -160,
        bottomLeft: -180,
        bottomRight: -160,
      }),
    ).toBeUndefined();
  });

  it("locates a vertical cut for a GeoJSON-flipped crossing tile (projected-CRS lngs)", () => {
    // dep_ls_geomad_066_022_2025 (EPSG:3832, PDC Mercator): projectTo4326
    // normalizes to (−180°, 180°], so the crossing edge is flipped —
    // topLeft/bottomLeft = 179.967798°, topRight/bottomRight = −179.169819°.
    const cut = antimeridianCut({
      topLeft: 179.967798,
      topRight: -179.169819,
      bottomLeft: 179.967798,
      bottomRight: -179.169819,
    });
    expect(cut).toBeDefined();
    // Unwrapped span is (179.967798, 180.830181); the 180° seam sits at
    // (180 − 179.967798) / (180.830181 − 179.967798) ≈ 0.0373 of the way in.
    expect(cut?.uCut).toBeCloseTo(0.037344, 5);
  });

  it("returns undefined for a degenerate zero-width edge (west === east)", () => {
    expect(
      antimeridianCut({
        topLeft: 170,
        topRight: 170,
        bottomLeft: 170,
        bottomRight: 170,
      }),
    ).toBeUndefined();
  });

  it("locates a cut for a piece far wider than the old (now-removed) 170° per-piece limit", () => {
    // Native lngs -100..190 (un-normalized, west<east): crosses +180° at
    // uCut = 280/290. The west piece alone is 280° wide -- comfortably past
    // the retired per-piece guard, but well under the 360° total-width
    // limit that's the only one left. See the antimeridian design doc's
    // "Seam handling" section.
    const cut = antimeridianCut({
      topLeft: -100,
      topRight: 190,
      bottomLeft: -100,
      bottomRight: 190,
    });
    expect(cut).toBeDefined();
    expect(cut?.uCut).toBeCloseTo(280 / 290, 9);
    expect(cut?.totalSpanDeg).toBeCloseTo(290, 9);
  });

  it("returns undefined for a self-overlapping tile (total width >= 360°)", () => {
    // -200..200 is 400° wide -- two pixel columns would claim the same
    // real-world longitude. Invalid data; no correct rendering exists,
    // cut or not.
    expect(
      antimeridianCut({
        topLeft: -200,
        topRight: 200,
        bottomLeft: -200,
        bottomRight: 200,
      }),
    ).toBeUndefined();
  });
});

describe("unwrapCommonSpaceX", () => {
  const TILE_SIZE = 512;

  it("leaves the seam itself unshifted (maps to exactly tileSize)", () => {
    const cut: AntimeridianCut = { uCut: 0.5, totalSpanDeg: 40 };
    expect(unwrapCommonSpaceX(TILE_SIZE, 0.5, cut, TILE_SIZE)).toBeCloseTo(
      TILE_SIZE,
      9,
    );
  });

  it("does not wrongly shift a wide piece's legitimate low-x point — the false positive the old x<256 heuristic hit", () => {
    // Mirrors the -100..190 example in the antimeridian design doc's "Seam
    // handling" section: native lng -90, 10° in from the tile's -100°
    // corner (u = 10/290), inside a
    // west piece spanning -100°..180° (280° wide). proj4 never wraps this
    // point at all — it projects straight to common-space x=128, which the
    // old `x < tileSize/2` test would have wrongly shifted by +tileSize.
    const cut: AntimeridianCut = { uCut: 280 / 290, totalSpanDeg: 290 };
    const u = 10 / 290;
    const actualX = 128;
    expect(unwrapCommonSpaceX(actualX, u, cut, TILE_SIZE)).toBeCloseTo(128, 6);
  });

  it("shifts an east-side point that genuinely wrapped, even in a wide tile, into the combined (seam-anchored) frame", () => {
    // Same tile; native lng 185° (5° past the seam, u = 285/290) wraps
    // under proj4 to -175° (common-space x≈7.11), but the seam-anchored
    // expectation for this u is TILE_SIZE plus 5° of common-space width —
    // the "combined" box the traversal's bounding volume wants (west below
    // TILE_SIZE, east above it).
    const cut: AntimeridianCut = { uCut: 280 / 290, totalSpanDeg: 290 };
    const u = 285 / 290;
    const actualX = (-175 / 360 + 0.5) * TILE_SIZE;
    expect(unwrapCommonSpaceX(actualX, u, cut, TILE_SIZE)).toBeCloseTo(
      TILE_SIZE + 5 * (TILE_SIZE / 360),
      6,
    );
  });
});

describe("unwrapEastLng", () => {
  it("adds 360° to a GeoJSON-flipped eastLng (west > east)", () => {
    expect(unwrapEastLng(179.967798, -179.169819)).toBeCloseTo(180.830181, 9);
  });

  it("passes through a native un-normalized eastLng unchanged (west < east)", () => {
    expect(unwrapEastLng(-204, -162)).toBe(-162);
  });

  it("passes through a degenerate zero-width edge unchanged (west === east)", () => {
    expect(unwrapEastLng(170, 170)).toBe(170);
  });
});
