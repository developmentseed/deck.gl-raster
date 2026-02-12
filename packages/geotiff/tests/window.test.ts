import { describe, expect, it } from "vitest";
import { createWindow, intersectWindows } from "../src/window.js";

describe("createWindow", () => {
  it("creates a valid window", () => {
    const w = createWindow(10, 20, 100, 200);
    expect(w).toEqual({ colOff: 10, rowOff: 20, width: 100, height: 200 });
  });

  it("rejects negative column offset", () => {
    expect(() => createWindow(-1, 0, 10, 10)).toThrow(/non-negative/);
  });

  it("rejects negative row offset", () => {
    expect(() => createWindow(0, -1, 10, 10)).toThrow(/non-negative/);
  });

  it("rejects zero width", () => {
    expect(() => createWindow(0, 0, 0, 10)).toThrow(/positive/);
  });

  it("rejects zero height", () => {
    expect(() => createWindow(0, 0, 10, 0)).toThrow(/positive/);
  });

  it("rejects negative dimensions", () => {
    expect(() => createWindow(0, 0, -5, 10)).toThrow(/positive/);
  });
});

describe("intersectWindows", () => {
  it("returns the overlapping region", () => {
    const a = createWindow(0, 0, 10, 10);
    const b = createWindow(5, 5, 10, 10);
    expect(intersectWindows(a, b)).toEqual({
      colOff: 5,
      rowOff: 5,
      width: 5,
      height: 5,
    });
  });

  it("returns null for non-overlapping windows", () => {
    const a = createWindow(0, 0, 5, 5);
    const b = createWindow(10, 10, 5, 5);
    expect(intersectWindows(a, b)).toBeNull();
  });

  it("returns null for edge-touching windows", () => {
    const a = createWindow(0, 0, 10, 10);
    const b = createWindow(10, 0, 10, 10);
    expect(intersectWindows(a, b)).toBeNull();
  });

  it("returns the contained window when one contains the other", () => {
    const outer = createWindow(0, 0, 100, 100);
    const inner = createWindow(10, 10, 20, 20);
    expect(intersectWindows(outer, inner)).toEqual(inner);
  });

  it("is commutative", () => {
    const a = createWindow(0, 0, 10, 10);
    const b = createWindow(5, 3, 10, 10);
    expect(intersectWindows(a, b)).toEqual(intersectWindows(b, a));
  });
});
