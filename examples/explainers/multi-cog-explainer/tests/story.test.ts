import { describe, expect, it } from "vitest";
import type { TextRun } from "../src/animation/story.js";
import { createStory } from "../src/animation/story.js";
import { BAND_IDS, BANDS } from "../src/scene/constants.js";
import { INTRO_SLOTS, SCENE_BOX, utmToScene } from "../src/scene/layout.js";
import { uvLabel } from "../src/scene/uv.js";
import { fakeScene } from "./fake-scene.js";

const story = createStory(fakeScene());

/** A step's last frame. */
function end(index: number) {
  const step = story[index]!;
  return step.frame(step.durationMs);
}

/** A description's text, without its emphasis and links. */
function plain(description: TextRun[]): string {
  return description
    .map((run) => (typeof run === "string" ? run : run.text))
    .join("");
}

describe("descriptions", () => {
  it("say the COGs are the AWS archive's, not how Sentinel-2 ships", () => {
    expect(plain(story[0]!.description)).toMatch(
      /^The Sentinel-2 archive on AWS stores each band/,
    );
  });

  it("present the band colors as this explainer's choice", () => {
    expect(plain(story[1]!.description)).toContain(
      "Here we map shortwave infrared to red, red to green, and coastal aerosol to blue",
    );
  });

  it("say the shader runs for every screen pixel the tile covers", () => {
    expect(plain(story[7]!.description)).toMatch(
      /^For every screen pixel the tile covers, the shader/,
    );
  });
});

describe("titles", () => {
  it("name the nine steps, in order", () => {
    expect(story.map((step) => step.title)).toEqual([
      "Three files, one scene",
      "One image",
      "The primary grid",
      "Every band has its own tiles",
      "Fetch",
      "Stitch",
      "Where the tile lands",
      "Sample",
      "The tile on the map",
    ]);
  });
});

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

  it("outlines each inset and its spot in the band's color, over a dark halo", () => {
    const { polygons } = end(0);
    const ids = polygons.map((p) => p.id);
    for (const band of BAND_IDS) {
      const outline = polygons.find((p) => p.id === `${band}-inset-outline`);
      expect(outline?.line).toEqual(BANDS[band].color);
      expect(ids.indexOf(`${band}-inset-halo`)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(`${band}-inset-halo`)).toBeLessThan(
        ids.indexOf(`${band}-inset-outline`),
      );
    }
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
  it("compares each band's tile area with the primary tile's", () => {
    // 20.48 km and 15.36 km tiles against 10.24 km ones.
    const text = plain(story[4]!.description);
    expect(text).toContain("A 20 m tile covers 4 times the ground");
    expect(text).toContain("and a 60 m tile 2.25 times");
  });

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

  it("states the story tile's own UV transforms, not fixed numbers", () => {
    const scene = fakeScene();
    // Not the real 60 m transform, so numbers written into the text fail.
    scene.tile.bands.b01.uvTransform = [0.25, 0.25, 0.5, 0.5];
    const text = plain(createStory(scene)[6]!.description);
    for (const band of BAND_IDS) {
      expect(text).toContain(uvLabel(scene.tile.bands[band].uvTransform));
    }
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
