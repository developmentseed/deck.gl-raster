import { describe, expect, it } from "vitest";
import { sampleBilinear, textureTexel } from "../src/scene/sampling.js";
import { fakeArray } from "./fake-scene.js";

const third = 1 / 3;

describe("textureTexel", () => {
  it("maps the tile's middle to the middle of the 60 m texture", () => {
    const [x, y] = textureTexel(
      [0.5, 0.5],
      [third, third, third, third],
      [512, 512],
    );
    expect(x).toBeCloseTo(256, 9);
    expect(y).toBeCloseTo(256, 9);
  });

  it("maps the tile's far corner to the middle of the 20 m texture", () => {
    const [x, y] = textureTexel([1, 1], [0, 0, 0.5, 0.5], [1024, 1024]);
    expect(x).toBeCloseTo(512, 9);
    expect(y).toBeCloseTo(512, 9);
  });
});

describe("sampleBilinear", () => {
  const values = [0, 100, 200, 300];
  const array = fakeArray(2, 2, (x, y) => values[y * 2 + x]!);

  it("blends the four texels around a point, like the GPU", () => {
    expect(sampleBilinear(array, [1, 1])).toBeCloseTo(150, 9);
  });

  it("returns a texel's own value at its centre", () => {
    expect(sampleBilinear(array, [1.5, 0.5])).toBeCloseTo(100, 9);
  });

  it("clamps at the edges, as clamp-to-edge sampling does", () => {
    expect(sampleBilinear(array, [0, 0])).toBeCloseTo(0, 9);
  });
});
