import { describe, expect, it } from "vitest";
import { pieceBoxWgs84 } from "../src/multi-cog-layer.js";

/**
 * `projectTo4326` normalizes lng to `(−180°, 180°]`. For a point sitting
 * exactly on an antimeridian-crossing tile's cut line, it returns `+180°`
 * regardless of which piece asked — real (west corner, cut corner, east
 * corner) values observed for the DEP GeoMAD `066/022` crossing item.
 */
function crossingProjectTo4326(px: number): [number, number] {
  if (px === 0) {
    return [179.9677978782272, -15.991730594838703];
  }
  if (px === 11.949079327358657) {
    return [180, -15.991730594838703];
  }
  if (px === 320) {
    return [-179.169819449018, -15.991730594838703];
  }
  throw new Error(`unexpected px ${px}`);
}

const identityForwardTransform = (px: number, py: number): [number, number] => [
  px,
  py,
];
const forwardTo4326 = (sx: number, _sy: number): [number, number] =>
  crossingProjectTo4326(sx);

describe("pieceBoxWgs84", () => {
  it("keeps the west piece's box within a small, continuous lng range", () => {
    const { path } = pieceBoxWgs84(
      identityForwardTransform,
      forwardTo4326,
      0,
      11.949079327358657,
      320,
    );
    const lngs = path.map((p) => p[0]);
    expect(Math.max(...lngs) - Math.min(...lngs)).toBeLessThan(1);
  });

  it("unwraps the east piece's cut corner so it stays continuous with the far corner, instead of belting the globe", () => {
    const { path } = pieceBoxWgs84(
      identityForwardTransform,
      forwardTo4326,
      11.949079327358657,
      320,
      320,
    );
    const lngs = path.map((p) => p[0]);
    // Un-fixed, the cut corner comes back as +180 while the far corner is
    // -179.17 — a ~359° span. Fixed, the cut corner is unwrapped to -180,
    // a ~0.83° span.
    expect(Math.max(...lngs) - Math.min(...lngs)).toBeLessThan(1);
  });
});
