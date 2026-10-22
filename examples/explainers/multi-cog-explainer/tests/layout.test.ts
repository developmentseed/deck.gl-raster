import { describe, expect, it } from "vitest";
import type { Rect } from "../src/scene/layout.js";
import {
  BARS_BOX,
  fitSlide,
  INTRO_SLOTS,
  SCENE_BOX,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  TEXTURE_SLOTS,
} from "../src/scene/layout.js";

function inside(rect: Rect): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.width <= SLIDE_WIDTH &&
    rect.y + rect.height <= SLIDE_HEIGHT
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

describe("fitSlide", () => {
  it.each([
    [1024, 768],
    [2560, 1080],
    [390, 844],
  ])("shows the whole slide, centred, in a %ix%i window", (width, height) => {
    const fit = fitSlide(width, height);
    expect(SLIDE_WIDTH * fit.scale).toBeLessThanOrEqual(width + 1e-9);
    expect(SLIDE_HEIGHT * fit.scale).toBeLessThanOrEqual(height + 1e-9);
    expect(fit.offsetX * 2 + SLIDE_WIDTH * fit.scale).toBeCloseTo(width, 9);
    expect(fit.offsetY * 2 + SLIDE_HEIGHT * fit.scale).toBeCloseTo(height, 9);
  });
});

describe("layout", () => {
  const boxes: Rect[] = [
    ...INTRO_SLOTS,
    SCENE_BOX,
    ...Object.values(TEXTURE_SLOTS),
    BARS_BOX,
  ];

  it("keeps every box inside the slide", () => {
    for (const box of boxes) {
      expect(inside(box)).toBe(true);
    }
  });

  it("keeps the scene, the texture slots and the bars apart", () => {
    const panels = [SCENE_BOX, ...Object.values(TEXTURE_SLOTS), BARS_BOX];
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        expect(overlaps(panels[i]!, panels[j]!)).toBe(false);
      }
    }
  });
});
