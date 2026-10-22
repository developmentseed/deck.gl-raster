import { describe, expect, it } from "vitest";
import type { Camera } from "../src/scene/layout.js";
import {
  CLOSEUP_BOX,
  cameraForBounds,
  commonToSlide,
  fitSlide,
  IMAGE_BOX,
  lerpCamera,
  MAP_BOX,
  STRIP_BOX,
  uvToSlide,
  viewFor,
} from "../src/scene/layout.js";

const camera: Camera = {
  rect: { x: 100, y: 200, width: 400, height: 300 },
  center: [10, 340],
  scale: 20,
};

describe("commonToSlide", () => {
  it("puts the camera's center at the middle of its box", () => {
    expect(commonToSlide(camera, [10, 340])).toEqual([300, 350]);
  });

  it("moves right with x and up with y, scale slide units per unit", () => {
    expect(commonToSlide(camera, [11, 341])).toEqual([320, 330]);
  });
});

describe("cameraForBounds", () => {
  it("fits wide bounds to the box's width", () => {
    const fitted = cameraForBounds(camera.rect, [0, 0, 100, 10], 0);
    expect(fitted.scale).toBe(4);
    expect(fitted.center).toEqual([50, 5]);
  });

  it("fits tall bounds to the box's height", () => {
    const fitted = cameraForBounds(camera.rect, [0, 0, 10, 100], 50);
    expect(fitted.scale).toBe(2);
  });
});

describe("lerpCamera", () => {
  it("zooms geometrically, halfway between 1 and 4 being 2", () => {
    const near = { ...camera, scale: 4 };
    const far = { ...camera, scale: 1 };
    expect(lerpCamera(far, near, 0.5).scale).toBeCloseTo(2, 9);
  });
});

describe("viewFor", () => {
  it("places the box in the letterboxed window, zoomed in CSS pixels", () => {
    // A 960 x 1080 window shows the slide at half scale, 270 px down.
    const fit = fitSlide(960, 1080);
    const view = viewFor(camera, fit);
    expect([view.x, view.y, view.width, view.height]).toEqual([
      50, 370, 200, 150,
    ]);
    expect(view.target).toEqual([10, 340, 0]);
    expect(view.zoom).toBeCloseTo(Math.log2(20 * 0.5), 9);
  });
});

describe("the boxes", () => {
  it("maps texture coordinate (1, 1) to the image box's far corner", () => {
    expect(uvToSlide([1, 1])).toEqual([
      IMAGE_BOX.x + IMAGE_BOX.width,
      IMAGE_BOX.y + IMAGE_BOX.height,
    ]);
  });

  it("splits the map box into the strip and, below a gap, the close-up", () => {
    expect(STRIP_BOX.y).toBe(MAP_BOX.y);
    expect(CLOSEUP_BOX.y).toBe(STRIP_BOX.y + STRIP_BOX.height + 20);
    expect(CLOSEUP_BOX.y + CLOSEUP_BOX.height).toBe(MAP_BOX.y + MAP_BOX.height);
  });
});
