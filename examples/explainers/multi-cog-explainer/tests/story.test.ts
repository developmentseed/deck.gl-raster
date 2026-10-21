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

describe("step 4: every band has its own tiles", () => {
  it("ends with the covering tiles outlined: one 20 m tile, four 60 m tiles", () => {
    const frame = end(3);
    const rings = (id: string) =>
      frame.polygons.find((p) => p.id === id)?.rings.length;
    expect(rings("cover-b11")).toBe(1);
    expect(rings("cover-b01")).toBe(4);
  });
});

/** The four 60 m pieces' rects in a frame, in tile order. */
function pieces(frame: ReturnType<typeof end>) {
  return [0, 1, 2, 3].map(
    (i) => frame.bitmaps.find((b) => b.image === `b01-piece-${i}`)?.rect,
  );
}

describe("step 5: fetch", () => {
  it("ends with the 60 m tiles in the slot's quadrants, 12 px apart", () => {
    expect(pieces(end(4))).toEqual([
      { x: 1520, y: 210, width: 144, height: 144 },
      { x: 1676, y: 210, width: 144, height: 144 },
      { x: 1520, y: 366, width: 144, height: 144 },
      { x: 1676, y: 366, width: 144, height: 144 },
    ]);
  });
});

describe("step 6: stitch", () => {
  it("ends with the 60 m tiles tiling the slot exactly", () => {
    expect(pieces(end(5))).toEqual([
      { x: 1520, y: 210, width: 150, height: 150 },
      { x: 1670, y: 210, width: 150, height: 150 },
      { x: 1520, y: 360, width: 150, height: 150 },
      { x: 1670, y: 360, width: 150, height: 150 },
    ]);
  });
});

describe("step 7: where the tile lands", () => {
  it("ends with the 60 m texture's middle ninth outlined", () => {
    const ring = end(6).polygons.find((p) => p.id === "uv-b01")?.rings[0];
    const xs = ring?.map(([x]) => x) ?? [];
    const ys = ring?.map(([, y]) => y) ?? [];
    expect(Math.min(...xs)).toBeCloseTo(1620, 6);
    expect(Math.max(...xs)).toBeCloseTo(1720, 6);
    expect(Math.min(...ys)).toBeCloseTo(310, 6);
    expect(Math.max(...ys)).toBeCloseTo(410, 6);
  });
});

describe("step 9: the tile on the map", () => {
  it("ends with the composited tile on the story tile's place in the scene", () => {
    const tile = end(8).composites.find((c) => c.source === "tile");
    // Tile (4, 4) is 10.24 km of the scene's 109.8 km, 4 tiles in each way.
    const size = (10240 / 109800) * SCENE_BOX.width;
    expect(tile?.rect.x).toBeCloseTo(SCENE_BOX.x + 4 * size, 6);
    expect(tile?.rect.y).toBeCloseTo(SCENE_BOX.y + 4 * size, 6);
    expect(tile?.rect.width).toBeCloseTo(size, 6);
    expect(tile?.opacity).toBe(1);
  });
});

describe("frames", () => {
  it("depend only on the step and the time, not on frames drawn before", () => {
    const before = story[4]!.frame(500);
    for (const step of story) {
      step.frame(0);
      step.frame(step.durationMs);
    }
    expect(story[4]!.frame(500)).toEqual(before);
  });
});
