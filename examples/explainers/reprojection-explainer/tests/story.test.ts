import { describe, expect, it } from "vitest";
import {
  counterText,
  createStory,
  DEFAULT_STORY_SETTINGS,
  uniqueEdges,
} from "../src/animation/story.js";
import { buildScene } from "../src/scene/build-scene.js";

// 8 px keeps the test mesh small: 100 triangles.
const scene = buildScene({ finalMaxError: 8 });
const story = createStory(scene, DEFAULT_STORY_SETTINGS);

describe("createStory", () => {
  it("has the six steps in order", () => {
    expect(story.map((step) => step.id)).toEqual([
      "start",
      "cut",
      "first-attempt",
      "refine",
      "fly-over",
      "result",
    ]);
  });

  it("draws the start and end of every step", () => {
    for (const step of story) {
      expect(() => step.frame(0)).not.toThrow();
      expect(() => step.frame(step.durationMs)).not.toThrow();
    }
  });

  it("draws every refinement phase without throwing", () => {
    const refine = story[3]!;
    for (let t = 0; t <= refine.durationMs; t += 37) {
      expect(() => refine.frame(t)).not.toThrow();
    }
  });

  it("starts with the 2-triangle seed and no edges", () => {
    const frame = story[0]!.frame(0);
    expect(frame.meshes).toHaveLength(1);
    expect(frame.meshes[0]!.soup.vertexCount).toBe(6);
    expect(frame.meshes[0]!.edgeColor[3]).toBe(0);
  });

  it("ends the first attempt showing the error", () => {
    const step = story[2]!;
    const frame = step.frame(step.durationMs);
    expect(frame.hud.counter).toContain("2 triangles");
    expect(frame.hud.counter).toContain("261 px");
    expect(frame.dots.map((dot) => dot.id)).toEqual(
      expect.arrayContaining(["split-source", "split-exact", "split-pin"]),
    );
  });

  it("ends the refinement at the final mesh", () => {
    const step = story[3]!;
    const frame = step.frame(step.durationMs);
    const target = frame.meshes.find((mesh) => mesh.id === "target")!;
    expect(target.soup.vertexCount / 3).toBe(100);
    expect(frame.hud.counter).toContain("100 triangles");
    expect(frame.dots).toEqual([]);
  });

  for (const flightStyle of ["direct", "fly-then-snap"] as const) {
    it(`lands every triangle on its exact position (${flightStyle})`, () => {
      const flyOver = createStory(scene, {
        ...DEFAULT_STORY_SETTINGS,
        flightStyle,
      })[4]!;
      const flight = flyOver
        .frame(flyOver.durationMs)
        .meshes.find((mesh) => mesh.id === "flight")!;
      const target = story[5]!
        .frame(0)
        .meshes.find((mesh) => mesh.id === "target")!;
      expect(flight.soup.positions.length).toBe(target.soup.positions.length);
      flight.soup.positions.forEach((value, i) => {
        expect(value).toBeCloseTo(target.soup.positions[i]!, 3);
      });
    });
  }

  it("names the library's default triangle count in the closing caption", () => {
    const step = story[5]!;
    expect(step.frame(step.durationMs).hud.caption).toContain("6,001");
  });
});

describe("counterText", () => {
  it("rounds large errors and converts them to kilometres", () => {
    expect(counterText(2, 260.9)).toBe(
      "2 triangles · max error 261 px (≈ 501 km)",
    );
  });

  it("keeps one decimal for small errors", () => {
    expect(counterText(194, 4)).toBe(
      "194 triangles · max error 4.0 px (≈ 8 km)",
    );
    expect(counterText(1512, 0.5)).toBe(
      "1,512 triangles · max error 0.5 px (< 1 km)",
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

/** The plain text of a step's description. */
function descriptionText(index: number): string {
  return story[index]!.description.map((run) =>
    typeof run === "string" ? run : run.text,
  ).join("");
}

describe("titles and descriptions", () => {
  it("gives every step a title and a description", () => {
    for (const step of story) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(descriptionText(story.indexOf(step)).length).toBeGreaterThan(40);
    }
  });

  it("states the 2-triangle error from the recorded refinement", () => {
    expect(descriptionText(2)).toContain("261 input pixels, or about 500 km");
  });

  it("states the threshold the refinement stopped at", () => {
    expect(descriptionText(3)).toContain("(here 8 px)");
  });

  it("links to delatin and names the default triangle count", () => {
    const runs = story[5]!.description;
    expect(runs).toContainEqual({
      text: "delatin",
      href: "https://github.com/mapbox/delatin",
    });
    expect(descriptionText(5)).toContain("would get 6,001 triangles");
  });
});

describe("refinement scrubber", () => {
  const refine = story[3]!;
  const scrubber = refine.scrubber!;
  const steps = scene.record.steps.length;

  it("has a position per split, plus the finished mesh", () => {
    expect(scrubber.count).toBe(steps + 1);
    expect(scrubber.label(37)).toBe(`37 / ${steps} splits`);
  });

  it("maps every position to a time and back", () => {
    for (let position = 0; position < scrubber.count; position++) {
      const time = scrubber.timeAt(position);
      expect(time).toBeGreaterThanOrEqual(0);
      expect(time).toBeLessThanOrEqual(refine.durationMs);
      expect(scrubber.positionAt(time)).toBe(position);
    }
  });

  it("shows the split's dots when paused, even on fast steps", () => {
    const fast = scrubber.timeAt(steps - 1);
    expect(refine.frame(fast, { paused: true }).dots.length).toBe(3);
    expect(refine.frame(fast).dots.length).toBe(0);
  });

  it("matches the mesh being drawn during playback", () => {
    for (let t = 0; t <= refine.durationMs; t += 7) {
      const target = refine
        .frame(t)
        .meshes.find((mesh) => mesh.id === "target")!;
      const position = scrubber.positionAt(t);
      const triangles =
        position === 0
          ? scene.record.seedTriangles.length
          : scene.record.steps[position - 1]!.triangles.length;
      expect(target.soup.vertexCount).toBe(triangles);
    }
  });

  it("only exists on the refinement step", () => {
    expect(
      story.filter((step) => step.scrubber).map((step) => step.id),
    ).toEqual(["refine"]);
  });
});
