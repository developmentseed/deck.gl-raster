import { describe, expect, it } from "vitest";
import {
  createLayout,
  fitRect,
  fitSlide,
  SOURCE_BOX,
  TARGET_BOX,
} from "../src/scene/layout.js";

const TARGET_BOUNDS: [number, number, number, number] = [
  -14391085, 2488141, -7026311, 6968531,
];

describe("fitRect", () => {
  it("fits by width and centres vertically", () => {
    const rect = fitRect(2500, 1641, SOURCE_BOX);
    expect(rect.width).toBeCloseTo(820, 6);
    expect(rect.height).toBeCloseTo((820 * 1641) / 2500, 6);
    expect(rect.x).toBeCloseTo(SOURCE_BOX.x, 6);
    expect(rect.y).toBeCloseTo(
      SOURCE_BOX.y + (SOURCE_BOX.height - rect.height) / 2,
      6,
    );
  });
});

describe("createLayout", () => {
  const layout = createLayout({
    imageWidth: 2500,
    imageHeight: 1641,
    targetBounds: TARGET_BOUNDS,
    sourceBox: SOURCE_BOX,
    targetBox: TARGET_BOX,
  });

  it("maps UV corners to the source rectangle's corners", () => {
    const { source } = layout;
    expect(layout.uvToSource(0, 0)).toEqual([source.x, source.y]);
    const [x, y] = layout.uvToSource(1, 1);
    expect(x).toBeCloseTo(source.x + source.width, 6);
    expect(y).toBeCloseTo(source.y + source.height, 6);
  });

  it("maps source pixels consistently with UVs", () => {
    const [x, y] = layout.pixelToSource(1250, 820.5);
    const [u, v] = layout.uvToSource(0.5, 0.5);
    expect(x).toBeCloseTo(u, 6);
    expect(y).toBeCloseTo(v, 6);
  });

  it("puts north up on the target panel", () => {
    const { target } = layout;
    const [x0, y0] = layout.targetToSlide(TARGET_BOUNDS[0], TARGET_BOUNDS[3]);
    const [x1, y1] = layout.targetToSlide(TARGET_BOUNDS[2], TARGET_BOUNDS[1]);
    expect(x0).toBeCloseTo(target.x, 6);
    expect(y0).toBeCloseTo(target.y, 6);
    expect(x1).toBeCloseTo(target.x + target.width, 6);
    expect(y1).toBeCloseTo(target.y + target.height, 6);
  });

  it("centres a source-sized copy on the target panel", () => {
    const { copy, source, target } = layout;
    expect(copy.width).toBeCloseTo(source.width, 6);
    expect(copy.height).toBeCloseTo(source.height, 6);
    expect(copy.x + copy.width / 2).toBeCloseTo(target.x + target.width / 2, 6);
    expect(copy.y + copy.height / 2).toBeCloseTo(
      target.y + target.height / 2,
      6,
    );
    expect(layout.uvToCopy(0, 0)).toEqual([copy.x, copy.y]);
  });
});

describe("fitSlide", () => {
  it("is the identity at 1920×1080", () => {
    expect(fitSlide(1920, 1080)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      zoom: 0,
    });
  });

  it("letterboxes a 16:10 window", () => {
    const fit = fitSlide(1920, 1200);
    expect(fit.scale).toBe(1);
    expect(fit.offsetY).toBe(60);
  });

  it("scales down to 1280×720", () => {
    const fit = fitSlide(1280, 720);
    expect(fit.scale).toBeCloseTo(2 / 3, 10);
    expect(fit.zoom).toBeCloseTo(Math.log2(2 / 3), 10);
    expect(fit.offsetX).toBeCloseTo(0, 10);
  });
});
