import { describe, expect, it } from "vitest";
import type { Frame } from "../src/animation/frame.js";
import {
  counterText,
  createStory,
  DEFAULT_STORY_SETTINGS,
  uniqueEdges,
} from "../src/animation/story.js";
import { buildScene } from "../src/scene/build-scene.js";

const scene = buildScene({ finalMaxError: 0.125 });
const story = createStory(scene, DEFAULT_STORY_SETTINGS);
const stepById = (id: string) => story.find((step) => step.id === id)!;
const target = (frame: Frame, id = "target") =>
  frame.meshes.find((mesh) => mesh.id === id)!.soup;

/** Width of the widest triangle in a soup, in slide units. */
function widestTriangle(positions: Float32Array): number {
  let widest = 0;
  for (let t = 0; t < positions.length / 6; t++) {
    const xs = [
      positions[6 * t]!,
      positions[6 * t + 2]!,
      positions[6 * t + 4]!,
    ];
    widest = Math.max(widest, Math.max(...xs) - Math.min(...xs));
  }
  return widest;
}

describe("createStory", () => {
  it("has the seven steps in order", () => {
    expect(story.map((step) => step.id)).toEqual([
      "start",
      "cut",
      "wrapped-corners",
      "unwrap",
      "refine",
      "fly-over",
      "result",
    ]);
  });

  it("draws every step at finite positions throughout", () => {
    for (const step of story) {
      for (let t = 0; t <= step.durationMs; t += 53) {
        const frame = step.frame(t);
        for (const mesh of frame.meshes) {
          expect(mesh.soup.positions.every(Number.isFinite)).toBe(true);
        }
        for (const line of frame.lines) {
          expect(line.paths.flat(2).every(Number.isFinite)).toBe(true);
        }
      }
    }
  });

  it("stretches the seed across the world when x wraps", () => {
    const step = stepById("wrapped-corners");
    const frame = step.frame(step.durationMs);
    const world = scene.worldLayout.target.width;
    expect(widestTriangle(target(frame, "flight").positions)).toBeGreaterThan(
      0.7 * world,
    );
    expect(frame.hud.counter).toContain("465 px");
  });

  it("closes the seed up as each corner is unwrapped", () => {
    const step = stepById("unwrap");
    const before = widestTriangle(target(step.frame(0)).positions);
    const end = step.frame(step.durationMs);
    expect(widestTriangle(target(end).positions)).toBeLessThan(
      scene.layout.target.width + 1,
    );
    expect(before).toBeGreaterThan(0.7 * scene.worldLayout.target.width);
    // It ends zoomed in, on the seed's exact positions.
    const seed = target(stepById("refine").frame(0));
    target(end).positions.forEach((value, i) => {
      expect(value).toBeCloseTo(seed.positions[i]!, 3);
    });
    expect(end.hud.counter).toBe(counterText(2, scene.record.seedMaxError));
  });

  it("shows each unwrap walk's samples, red where proj4 puts them", () => {
    const step = stepById("unwrap");
    const ids = new Set<string>();
    for (let t = 0; t <= step.durationMs; t += 50) {
      for (const dot of step.frame(t).dots) {
        ids.add(dot.id);
      }
    }
    expect([...ids].sort()).toEqual([
      "unwrap-raw",
      "unwrap-snapped",
      "unwrap-source",
    ]);
  });

  it("ends the refinement at the final mesh", () => {
    const step = stepById("refine");
    const frame = step.frame(step.durationMs);
    expect(target(frame).vertexCount / 3).toBe(32);
    expect(frame.hud.counter).toContain("32 triangles");
    expect(frame.dots).toEqual([]);
  });

  it("notes the splits whose vertex proj4 returned a world away", () => {
    const refine = stepById("refine");
    const scrubber = refine.scrubber!;
    const captions = new Set(
      Array.from(
        { length: scrubber.count - 1 },
        (_, k) =>
          refine.frame(scrubber.timeAt(k), { paused: true }).hud.caption,
      ),
    );
    expect(captions.size).toBe(2);
  });

  for (const flightStyle of ["direct", "fly-then-snap"] as const) {
    it(`lands every triangle on its exact position (${flightStyle})`, () => {
      const flyOver = createStory(scene, {
        ...DEFAULT_STORY_SETTINGS,
        flightStyle,
      })[5]!;
      const flight = target(flyOver.frame(flyOver.durationMs), "flight");
      const final = target(story[6]!.frame(0));
      flight.positions.forEach((value, i) => {
        expect(value).toBeCloseTo(final.positions[i]!, 3);
      });
    });
  }

  it("draws the 180° meridian through the final mesh", () => {
    const frame = story[6]!.frame(0);
    const [x] = frame.lines.find((line) => line.id === "edge-east")!
      .paths[0]![0]!;
    const xs = target(frame).positions.filter((_, i) => i % 2 === 0);
    expect(x).toBeGreaterThan(Math.min(...xs));
    expect(x).toBeLessThan(Math.max(...xs));
  });

  it("only has a scrubber on the refinement step", () => {
    expect(
      story.filter((step) => step.scrubber).map((step) => step.id),
    ).toEqual(["refine"]);
  });
});

describe("counterText", () => {
  it("converts errors to kilometres at 20 km per pixel", () => {
    expect(counterText(2, 465.1)).toBe(
      "2 triangles · max error 465 px (≈ 9,302 km)",
    );
    expect(counterText(32, 0.123)).toBe(
      "32 triangles · max error 0.12 px (≈ 2 km)",
    );
  });
});

describe("uniqueEdges", () => {
  it("lists a shared edge once", () => {
    expect(uniqueEdges([0, 1, 2, 2, 1, 3])).toEqual([
      [0, 1],
      [1, 2],
      [2, 0],
      [1, 3],
      [3, 2],
    ]);
  });
});

describe("titles and descriptions", () => {
  it("gives every step a title and a description", () => {
    for (const step of story) {
      const text = step.description
        .map((run) => (typeof run === "string" ? run : run.text))
        .join("");
      expect(step.title.length).toBeGreaterThan(0);
      expect(text.length).toBeGreaterThan(40);
    }
  });
});
