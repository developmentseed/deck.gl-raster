import { describe, expect, it } from "vitest";
import { uvLabel, uvRect } from "../src/scene/uv.js";

const third = 1 / 3;

describe("uvRect", () => {
  it("puts the middle ninth of a 300 px slot at its centre", () => {
    const rect = uvRect({ x: 1520, y: 210, width: 300, height: 300 }, [
      third,
      third,
      third,
      third,
    ]);
    expect(rect.x).toBeCloseTo(1620, 9);
    expect(rect.y).toBeCloseTo(310, 9);
    expect(rect.width).toBeCloseTo(100, 9);
    expect(rect.height).toBeCloseTo(100, 9);
  });
});

describe("uvLabel", () => {
  it("rounds to two decimals", () => {
    expect(uvLabel([third, third, third, third])).toBe(
      "offset (0.33, 0.33) · scale (0.33, 0.33)",
    );
  });

  it("drops trailing zeros", () => {
    expect(uvLabel([0, 0, 0.5, 0.5])).toBe("offset (0, 0) · scale (0.5, 0.5)");
  });
});
