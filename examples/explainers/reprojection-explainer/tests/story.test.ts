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
  it("has the eight steps in order", () => {
    expect(story.map((step) => step.id)).toEqual([
      "start",
      "cut",
      "first-attempt",
      "measure",
      "refine",
      "flip",
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
    const refine = story[4]!;
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

  it("hides the true outline until the corners are projected", () => {
    const ids = (frame: { lines: { id: string }[] }) =>
      frame.lines.map((line) => line.id);
    expect(ids(story[0]!.frame(0))).toEqual(["truth-parallel"]);
    expect(ids(story[1]!.frame(story[1]!.durationMs))).toEqual([
      "truth-parallel",
    ]);
    const step = story[2]!;
    const outline = (t: number) =>
      step.frame(t).lines.find((line) => line.id === "truth-outline")!;
    expect(outline(0).color[3]).toBe(0);
    expect(outline(step.durationMs).color[3]).toBeGreaterThan(0);
  });

  it("leaves measuring the error to the next step", () => {
    const step = story[2]!;
    const frame = step.frame(step.durationMs);
    expect(frame.hud.counter).toBeNull();
    expect(frame.dots).toEqual([]);
  });

  it("shows every distinct seed test point and labels the worst", () => {
    const step = story[3]!;
    const frame = step.frame(step.durationMs);
    // 2 triangles × 4 points, minus the shared diagonal's midpoint.
    const guesses = frame.dots.find((dot) => dot.id === "samples-guess")!;
    expect(guesses.points).toHaveLength(7);
    const worst = frame.hud.labels.filter((l) => l.text.includes("worst"));
    expect(worst.map((l) => l.text)).toEqual(["261 px · worst"]);
  });

  it("ends the refinement at the final mesh", () => {
    const step = story[4]!;
    const frame = step.frame(step.durationMs);
    const target = frame.meshes.find((mesh) => mesh.id === "target")!;
    expect(target.soup.vertexCount / 3).toBe(100);
    expect(frame.hud.counter).toContain("100 triangles");
    expect(frame.dots).toEqual([]);
  });

  it("shows a thin pair of triangles, then the flipped pair", () => {
    const step = story[5]!;
    const flip = scene.flip!;
    const target = (t: number) =>
      step.frame(t).meshes.find((mesh) => mesh.id === "target")!.soup;
    const after = scene.record.steps[flip.step]!.triangles;
    expect(target(0).vertexCount).toBe(after.length);
    expect(target(0).positions).not.toEqual(target(step.durationMs).positions);
    const diagonal = step
      .frame(step.durationMs)
      .lines.find((line) => line.id === "flip-diagonal")!;
    expect(diagonal.color.slice(0, 3)).toEqual([48, 209, 88]);
    expect(descriptionText(5)).toContain(`split ${flip.step + 1}`);
  });

  for (const flightStyle of ["direct", "fly-then-snap"] as const) {
    it(`lands every triangle on its exact position (${flightStyle})`, () => {
      const flyOver = createStory(scene, {
        ...DEFAULT_STORY_SETTINGS,
        flightStyle,
      })[6]!;
      const flight = flyOver
        .frame(flyOver.durationMs)
        .meshes.find((mesh) => mesh.id === "flight")!;
      const target = story[7]!
        .frame(0)
        .meshes.find((mesh) => mesh.id === "target")!;
      expect(flight.soup.positions.length).toBe(target.soup.positions.length);
      flight.soup.positions.forEach((value, i) => {
        expect(value).toBeCloseTo(target.soup.positions[i]!, 3);
      });
    });
  }

  it("names the library's default triangle count in the closing caption", () => {
    const step = story[7]!;
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
    expect(descriptionText(3)).toContain("261 input pixels, or about 500 km");
  });

  it("states the threshold the refinement stopped at", () => {
    expect(descriptionText(4)).toContain("(here 8 px)");
  });

  it("links to delatin and names the default triangle count", () => {
    const runs = story[7]!.description;
    expect(runs).toContainEqual({
      text: "delatin",
      href: "https://github.com/mapbox/delatin",
    });
    expect(descriptionText(7)).toContain("would get 6,001 triangles");
  });
});

describe("refinement scrubber", () => {
  const refine = story[4]!;
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

  it("shows the split's dots and test points when paused, even on fast steps", () => {
    const fast = scrubber.timeAt(steps - 1);
    expect(
      refine.frame(fast, { paused: true }).dots.map((dot) => dot.id),
    ).toEqual([
      "samples-source",
      "samples-guess",
      "samples-exact",
      "split-source",
      "split-exact",
      "split-pin",
    ]);
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

  it("shades every triangle by its score, the split one in orange", () => {
    const k = 5;
    const frame = refine.frame(scrubber.timeAt(k), { paused: true });
    const tints = frame.meshes.find((mesh) => mesh.id === "target")!.soup
      .tints!;
    const alphas = Array.from(
      { length: tints.length / 12 },
      (_, t) => tints[12 * t + 3]!,
    );
    expect(alphas.every((alpha) => alpha > 0)).toBe(true);
    const split = scene.record.steps[k]!.split.index;
    expect(tints[12 * split + 1]).toBeGreaterThan(0.5); // orange, not red
    expect(frame.hud.caption).toContain("score");
  });

  it("only exists on the refinement step", () => {
    expect(
      story.filter((step) => step.scrubber).map((step) => step.id),
    ).toEqual(["refine"]);
  });
});
