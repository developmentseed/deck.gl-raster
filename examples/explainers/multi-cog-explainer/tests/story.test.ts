import { describe, expect, it } from "vitest";
import { createStory } from "../src/animation/story.js";
import { INTRO_SLOTS, SCENE_BOX, utmToScene } from "../src/scene/layout.js";
import { fakeScene } from "./fake-scene.js";

const story = createStory(fakeScene());

/** A step's last frame. */
function end(index: number) {
  const step = story[index]!;
  return step.frame(step.durationMs);
}

describe("utmToScene", () => {
  it("maps the scene's top-left corner to the scene box's", () => {
    expect(utmToScene(600000, 4400020)).toEqual([SCENE_BOX.x, SCENE_BOX.y]);
  });

  it("maps the scene's bottom-right corner to the scene box's", () => {
    const [x, y] = utmToScene(709800, 4290220);
    expect(x).toBeCloseTo(SCENE_BOX.x + SCENE_BOX.width, 9);
    expect(y).toBeCloseTo(SCENE_BOX.y + SCENE_BOX.height, 9);
  });
});

describe("step 1: three files, one scene", () => {
  it("ends with the three bands in their slots, and an inset each", () => {
    const frame = end(0);
    const overviews = frame.bitmaps.filter((b) =>
      b.image.endsWith("-overview"),
    );
    expect(overviews.map((b) => b.rect)).toEqual(INTRO_SLOTS);
    const insets = frame.bitmaps.filter((b) => b.image.endsWith("-inset"));
    expect(insets.map((b) => b.image)).toEqual([
      "b04-inset",
      "b11-inset",
      "b01-inset",
    ]);
  });
});

describe("step 2: one image", () => {
  it("ends with the overview composite in the scene box, and no band images", () => {
    const frame = end(1);
    expect(frame.composites).toEqual([
      { id: "scene", source: "overview", rect: SCENE_BOX, opacity: 1 },
    ]);
    expect(frame.bitmaps).toEqual([]);
  });
});
