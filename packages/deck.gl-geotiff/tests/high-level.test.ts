import type { GeoTransform } from "@developmentseed/raster-reproject/affine";
import { describe, expect, it } from "vitest";
import { isMaskIfd } from "../src/geotiff/high-level/geotiff";
import { index, xy } from "../src/geotiff/high-level/transform";
import {
  createWindow,
  intersectWindows,
} from "../src/geotiff/high-level/window";

// ── Window ──────────────────────────────────────────────────────────────────

describe("createWindow", () => {
  it("creates a valid window", () => {
    const w = createWindow(10, 20, 100, 200);
    expect(w).toEqual({ colOff: 10, rowOff: 20, width: 100, height: 200 });
  });

  it("throws on negative colOff", () => {
    expect(() => createWindow(-1, 0, 10, 10)).toThrow(/non-negative/);
  });

  it("throws on negative rowOff", () => {
    expect(() => createWindow(0, -5, 10, 10)).toThrow(/non-negative/);
  });

  it("throws on zero width", () => {
    expect(() => createWindow(0, 0, 0, 10)).toThrow(/positive/);
  });

  it("throws on negative height", () => {
    expect(() => createWindow(0, 0, 10, -3)).toThrow(/positive/);
  });
});

describe("intersectWindows", () => {
  it("returns the overlap of two intersecting windows", () => {
    const a = createWindow(0, 0, 100, 100);
    const b = createWindow(50, 30, 100, 100);
    const result = intersectWindows(a, b);
    expect(result).toEqual({ colOff: 50, rowOff: 30, width: 50, height: 70 });
  });

  it("returns null for non-overlapping windows (horizontal)", () => {
    const a = createWindow(0, 0, 10, 10);
    const b = createWindow(20, 0, 10, 10);
    expect(intersectWindows(a, b)).toBeNull();
  });

  it("returns null for non-overlapping windows (vertical)", () => {
    const a = createWindow(0, 0, 10, 10);
    const b = createWindow(0, 20, 10, 10);
    expect(intersectWindows(a, b)).toBeNull();
  });

  it("returns null for edge-touching windows (no overlap)", () => {
    const a = createWindow(0, 0, 10, 10);
    const b = createWindow(10, 0, 10, 10); // touches at col 10 but doesn't overlap
    expect(intersectWindows(a, b)).toBeNull();
  });

  it("handles one window fully contained in another", () => {
    const outer = createWindow(0, 0, 100, 100);
    const inner = createWindow(10, 20, 30, 40);
    const result = intersectWindows(outer, inner);
    expect(result).toEqual({ colOff: 10, rowOff: 20, width: 30, height: 40 });
  });

  it("is commutative", () => {
    const a = createWindow(5, 10, 50, 60);
    const b = createWindow(20, 25, 80, 90);
    expect(intersectWindows(a, b)).toEqual(intersectWindows(b, a));
  });
});

// ── Transform ───────────────────────────────────────────────────────────────

// A simple non-rotated transform: 10m pixels, origin at (500000, 6000000)
// x = 10 * col + 500000
// y = -10 * row + 6000000
const SIMPLE_TRANSFORM: GeoTransform = [10, 0, 500000, 0, -10, 6000000];

describe("index", () => {
  it("maps a geographic coordinate to the correct pixel", () => {
    // (500005, 5999995) should be col=0.5, row=0.5 → floor → [0, 0]
    const [row, col] = index(SIMPLE_TRANSFORM, 500005, 5999995);
    expect(row).toBe(0);
    expect(col).toBe(0);
  });

  it("maps a coordinate at pixel boundary", () => {
    // col=2, row=3 exactly
    const [row, col] = index(SIMPLE_TRANSFORM, 500020, 5999970);
    expect(row).toBe(3);
    expect(col).toBe(2);
  });

  it("supports a custom rounding op (Math.round)", () => {
    // col=0.7, row=0.3 → round → col=1, row=0
    const [row, col] = index(SIMPLE_TRANSFORM, 500007, 5999997, Math.round);
    expect(row).toBe(0);
    expect(col).toBe(1);
  });
});

describe("xy", () => {
  it("returns the center of a pixel by default", () => {
    // pixel (0, 0) center: col=0.5, row=0.5
    // x = 10*0.5 + 500000 = 500005
    // y = -10*0.5 + 6000000 = 5999995
    const [x, y] = xy(SIMPLE_TRANSFORM, 0, 0);
    expect(x).toBeCloseTo(500005);
    expect(y).toBeCloseTo(5999995);
  });

  it("returns upper-left corner with offset='ul'", () => {
    const [x, y] = xy(SIMPLE_TRANSFORM, 0, 0, "ul");
    expect(x).toBeCloseTo(500000);
    expect(y).toBeCloseTo(6000000);
  });

  it("returns lower-right corner with offset='lr'", () => {
    // col=1, row=1: x = 10*1 + 500000 = 500010, y = -10*1 + 6000000 = 5999990
    const [x, y] = xy(SIMPLE_TRANSFORM, 0, 0, "lr");
    expect(x).toBeCloseTo(500010);
    expect(y).toBeCloseTo(5999990);
  });
});

describe("index / xy round-trip", () => {
  it("round-trips through center offset", () => {
    const row = 7;
    const col = 13;
    const [x, y] = xy(SIMPLE_TRANSFORM, row, col, "center");
    const [rRow, rCol] = index(SIMPLE_TRANSFORM, x, y);
    expect(rRow).toBe(row);
    expect(rCol).toBe(col);
  });
});

// ── isMaskIfd ───────────────────────────────────────────────────────────────

function makeMockImage(fileDirectory: Record<string, unknown>) {
  return {
    getFileDirectory: () => fileDirectory,
  };
}

describe("isMaskIfd", () => {
  it("detects a mask IFD (NewSubfileType bit 2 set + TransparencyMask)", () => {
    const image = makeMockImage({
      NewSubfileType: 4, // bit 2 set
      PhotometricInterpretation: 4, // TransparencyMask
    });
    expect(isMaskIfd(image as any)).toBe(true);
  });

  it("detects a mask IFD when NewSubfileType has other bits too", () => {
    const image = makeMockImage({
      NewSubfileType: 6, // bits 1 and 2 set
      PhotometricInterpretation: 4,
    });
    expect(isMaskIfd(image as any)).toBe(true);
  });

  it("rejects when NewSubfileType bit 2 is not set", () => {
    const image = makeMockImage({
      NewSubfileType: 1, // reduced resolution but not a mask
      PhotometricInterpretation: 4,
    });
    expect(isMaskIfd(image as any)).toBe(false);
  });

  it("rejects when PhotometricInterpretation is not TransparencyMask", () => {
    const image = makeMockImage({
      NewSubfileType: 4,
      PhotometricInterpretation: 1, // BlackIsZero
    });
    expect(isMaskIfd(image as any)).toBe(false);
  });

  it("rejects a normal data IFD (no NewSubfileType)", () => {
    const image = makeMockImage({
      PhotometricInterpretation: 2, // RGB
    });
    expect(isMaskIfd(image as any)).toBe(false);
  });

  it("treats missing NewSubfileType as 0", () => {
    const image = makeMockImage({
      // NewSubfileType absent
      PhotometricInterpretation: 4,
    });
    expect(isMaskIfd(image as any)).toBe(false);
  });
});

// ── Overview tile window clamping ───────────────────────────────────────────

describe("Overview edge-tile clamping", () => {
  // Verify the math: for an image 1000×1000 with 256×256 tiles,
  // tile (3, 3) should clamp to [768, 768, 1000, 1000] → 232×232 pixels
  it("edge tile dimensions are correct", () => {
    const imageWidth = 1000;
    const imageHeight = 1000;
    const tileWidth = 256;
    const tileHeight = 256;
    const x = 3;
    const y = 3;

    const left = x * tileWidth;
    const top = y * tileHeight;
    const right = Math.min(left + tileWidth, imageWidth);
    const bottom = Math.min(top + tileHeight, imageHeight);

    expect(left).toBe(768);
    expect(top).toBe(768);
    expect(right).toBe(1000);
    expect(bottom).toBe(1000);
    expect(right - left).toBe(232);
    expect(bottom - top).toBe(232);
  });

  it("interior tile is full size", () => {
    const imageWidth = 1000;
    const imageHeight = 1000;
    const tileWidth = 256;
    const tileHeight = 256;
    const x = 1;
    const y = 1;

    const left = x * tileWidth;
    const top = y * tileHeight;
    const right = Math.min(left + tileWidth, imageWidth);
    const bottom = Math.min(top + tileHeight, imageHeight);

    expect(right - left).toBe(256);
    expect(bottom - top).toBe(256);
  });
});
