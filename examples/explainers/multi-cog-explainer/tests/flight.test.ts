import { describe, expect, it } from "vitest";
import { flyRect } from "../src/animation/flight.js";

const from = { x: 0, y: 0, width: 10, height: 20 };
const to = { x: 100, y: 200, width: 30, height: 40 };

describe("flyRect", () => {
  it("starts at the source", () => {
    expect(flyRect(from, to, 0)).toEqual(from);
  });

  it("ends at the target", () => {
    expect(flyRect(from, to, 1)).toEqual(to);
  });

  it("is halfway at the midpoint, with ease-in-out timing", () => {
    expect(flyRect(from, to, 0.5)).toEqual({
      x: 50,
      y: 100,
      width: 20,
      height: 30,
    });
  });
});
