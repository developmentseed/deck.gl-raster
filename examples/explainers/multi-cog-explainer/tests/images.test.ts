import { describe, expect, it } from "vitest";
import { stretchToBytes } from "../src/render/images.js";

describe("stretchToBytes", () => {
  it("maps the range linearly to 0-255, clamping outside it", () => {
    const bytes = stretchToBytes(Uint16Array.of(0, 1000, 4000, 65535), {
      min: 0,
      max: 4000,
    });
    expect(Array.from(bytes)).toEqual([0, 64, 255, 255]);
  });
});
