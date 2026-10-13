import { describe, expect, it } from "vitest";
import {
  counterText,
  createStory,
  DEFAULT_STORY_SETTINGS,
  seedPointPhrase,
  uniqueEdges,
} from "../src/animation/story.js";
import { ARCTIC_SCENARIO } from "../src/scene/arctic.js";
import { buildScene } from "../src/scene/build-scene.js";
import { SLIDE_WIDTH } from "../src/scene/layout.js";
import { NLCD_SCENARIO } from "../src/scene/nlcd.js";

// 8 px keeps the test mesh small: 100 triangles.
const scene = buildScene({ scenario: NLCD_SCENARIO, finalMaxError: 8 });
const story = createStory(scene, DEFAULT_STORY_SETTINGS);
// The same, with the error measured on the map: 106 triangles.
const targetScene = buildScene({
  scenario: NLCD_SCENARIO,
  finalMaxError: 8,
  errorSpace: "target",
});
const targetStory = createStory(targetScene, DEFAULT_STORY_SETTINGS);

describe("createStory", () => {
  it("has the seven steps in order", () => {
    expect(story.map((step) => step.id)).toEqual([
      "start",
      "cut",
      "first-attempt",
      "measure",
      "refine",
      "fly-over",
      "result",
    ]);
  });

  for (const [mode, steps] of [
    ["source", story],
    ["target", targetStory],
  ] as const) {
    it(`draws the start and end of every step (${mode})`, () => {
      for (const step of steps) {
        expect(() => step.frame(0)).not.toThrow();
        expect(() => step.frame(step.durationMs)).not.toThrow();
      }
    });

    it(`draws every refinement phase without throwing (${mode})`, () => {
      const refine = steps[4]!;
      for (let t = 0; t <= refine.durationMs; t += 37) {
        expect(() => refine.frame(t)).not.toThrow();
        expect(() => refine.frame(t, { paused: true })).not.toThrow();
      }
    });
  }

  it("starts with the 2-triangle seed and no edges", () => {
    const frame = story[0]!.frame(0);
    expect(frame.meshes).toHaveLength(1);
    expect(frame.meshes[0]!.soup.vertexCount).toBe(6);
    expect(frame.meshes[0]!.edgeColor[3]).toBe(0);
  });

  it("shows the image's true outline from the first step", () => {
    const ids = story[0]!.frame(0).lines.map((line) => line.id);
    expect(ids).toEqual(["truth-outline", "truth-parallel"]);
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

  it("starts measuring where the first attempt ends", () => {
    const ids = (items: { id: string }[]) => items.map((item) => item.id);
    const end = story[2]!.frame(story[2]!.durationMs);
    const start = story[3]!.frame(0);
    expect(ids(start.dots)).toEqual(ids(end.dots));
    expect(ids(start.lines)).toEqual(ids(end.lines));
    expect(start.hud.counter).toBe(end.hud.counter);
  });

  /** The measure step's error labels, once they're all in. */
  const errorLabels = (steps = story) => {
    const step = steps[3]!;
    const frame = step.frame(step.durationMs);
    return {
      frame,
      labels: frame.hud.labels.filter((l) => l.id.startsWith("sample-error")),
    };
  };

  it("labels every distinct seed test point, the worst one largest", () => {
    const { frame, labels } = errorLabels();
    // 2 triangles × 4 points, minus the shared diagonal's midpoint.
    const guesses = frame.dots.find((dot) => dot.id === "samples-guess")!;
    expect(guesses.points).toHaveLength(7);
    expect(labels).toHaveLength(7);
    const worst = labels.find((l) => l.text.includes("worst"))!;
    expect(worst.text).toBe("261 px · worst");
    for (const label of labels) {
      if (label !== worst) {
        expect(label.size).toBeLessThan(worst.size!);
      }
    }
  });

  // Each mode labels the gap it measures, past its true end: the test point
  // in the input image for source pixels, the exact spot on the map for
  // target pixels.
  for (const [mode, steps, labelledDot] of [
    ["source", story, "samples-source"],
    ["target", targetStory, "samples-exact"],
  ] as const) {
    it(`labels each error next to the end of its gap (${mode})`, () => {
      const { frame, labels } = errorLabels(steps);
      const ends = frame.dots.find((dot) => dot.id === labelledDot)!.points;
      expect(labels).toHaveLength(ends.length);
      labels.forEach((label, i) => {
        const [x, y] = ends[i]!;
        expect(Math.hypot(label.x - x, label.y - y)).toBeLessThan(40);
        if (label.align === "left") {
          expect(label.x).toBeGreaterThan(x + 10);
        } else if (label.align === "right") {
          expect(label.x).toBeLessThan(x - 10);
        } else {
          // Centred labels sit above or below the dot, past half a line.
          expect(Math.abs(label.y - y)).toBeGreaterThan(0.6 * label.size! + 10);
        }
      });
    });
  }

  // Below the panel titles, above the description, and on the slide.
  for (const scenario of [NLCD_SCENARIO, ARCTIC_SCENARIO]) {
    for (const errorSpace of ["source", "target"] as const) {
      it(`keeps the ${scenario.id} error labels clear of the text (${errorSpace})`, () => {
        const steps = createStory(
          buildScene({ scenario, finalMaxError: 32, errorSpace }),
          DEFAULT_STORY_SETTINGS,
        );
        for (const label of errorLabels(steps).labels) {
          const size = label.size!;
          // A generous estimate of the label's width: 0.6 em per character.
          const width = 0.6 * size * label.text.length;
          const left =
            label.align === "left"
              ? label.x
              : label.align === "right"
                ? label.x - width
                : label.x - width / 2;
          expect(left).toBeGreaterThanOrEqual(0);
          expect(left + width).toBeLessThanOrEqual(SLIDE_WIDTH);
          expect(label.y - 0.6 * size).toBeGreaterThanOrEqual(150);
          expect(label.y + 0.6 * size).toBeLessThanOrEqual(790);
        }
      });
    }
  }

  it("draws each test point's gap in the input image (source)", () => {
    const { frame } = errorLabels();
    const points = (id: string) =>
      frame.dots.find((dot) => dot.id === id)!.points;
    const gaps = frame.lines.find((line) => line.id === "samples-source-gap")!;
    expect(gaps.paths).toEqual(
      points("samples-source").map((p, i) => [p, points("samples-sampled")[i]]),
    );
  });

  it("draws no gaps in the input image when measuring on the map", () => {
    const { frame } = errorLabels(targetStory);
    const ids = [...frame.dots, ...frame.lines].map((item) => item.id);
    expect(ids).not.toContain("samples-sampled");
    expect(ids).not.toContain("samples-source-gap");
  });

  it("ends the refinement at the final mesh", () => {
    const step = story[4]!;
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
      })[5]!;
      const flight = flyOver
        .frame(flyOver.durationMs)
        .meshes.find((mesh) => mesh.id === "flight")!;
      const target = story[6]!
        .frame(0)
        .meshes.find((mesh) => mesh.id === "target")!;
      expect(flight.soup.positions.length).toBe(target.soup.positions.length);
      flight.soup.positions.forEach((value, i) => {
        expect(value).toBeCloseTo(target.soup.positions[i]!, 3);
      });
    });
  }

  it("names the library's default triangle count in the closing caption", () => {
    const step = story[6]!;
    expect(step.frame(step.durationMs).hud.caption).toContain("6,001");
  });

  it("counts the default triangles on the map when measuring there", () => {
    const step = targetStory[6]!;
    expect(step.frame(step.durationMs).hud.caption).toContain("6,563");
  });

  it("states the unit of the error being measured in the counter", () => {
    const end = (steps: typeof story) =>
      steps[2]!.frame(steps[2]!.durationMs).hud.counter;
    expect(end(story)).toContain("max error 261 px (");
    expect(end(targetStory)).toContain("max error 279 px on the map (");
  });
});

describe("counterText", () => {
  it("names the unit it's given", () => {
    expect(
      counterText(2, 279, { kmPerPixel: 1.92, unit: "px on the map" }),
    ).toBe("2 triangles · max error 279 px on the map (≈ 536 km)");
  });

  it("rounds large errors and converts them to kilometres", () => {
    expect(counterText(2, 260.9, { kmPerPixel: 1.92 })).toBe(
      "2 triangles · max error 261 px (≈ 501 km)",
    );
  });

  it("keeps one decimal for small errors", () => {
    expect(counterText(194, 4, { kmPerPixel: 1.92 })).toBe(
      "194 triangles · max error 4.0 px (≈ 8 km)",
    );
    expect(counterText(1512, 0.5, { kmPerPixel: 1.92 })).toBe(
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
function descriptionText(index: number, steps = story): string {
  return steps[index]!.description.map((run) =>
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

  it("keeps the NLCD scenario's hand-written text", () => {
    expect(descriptionText(0)).toBe(
      "This is the image we want to render. It's stored in an Albers equal-area projection, but we want to display it in Web Mercator. Note the 49th parallel: in Albers equal-area it's curved, while in Web Mercator it's a straight line.",
    );
    expect(descriptionText(2)).toBe(
      "We project the corners of each triangle to Web Mercator, then stretch the image linearly within each triangle. There's a lot of distortion, because we've only projected the corners: at the center of the image, it's 261 input pixels, or about 500 km.",
    );
  });

  it("states the 2-triangle error from the recorded refinement", () => {
    expect(descriptionText(2)).toContain("261 input pixels, or about 500 km");
  });

  it("states where and how far off the 2-triangle mesh is on the map", () => {
    expect(descriptionText(2, targetStory)).toContain(
      "at the middle of the image's top edge, it's 279 pixels on the map, or about 540 km",
    );
  });

  it("states the threshold the refinement stopped at", () => {
    expect(descriptionText(4)).toContain("(here 8 px)");
  });

  it("links to delatin and its author, and names the default triangle count", () => {
    const runs = story[6]!.description;
    expect(runs).toContainEqual({
      text: "delatin",
      href: "https://github.com/mapbox/delatin",
    });
    expect(runs).toContainEqual({
      text: "Volodymyr Agafonkin",
      href: "https://agafonkin.com/",
    });
    expect(descriptionText(6)).toContain("would get 6,001 triangles");
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
      "samples-sampled",
      "split-source",
      "split-exact",
      "split-pin",
    ]);
    expect(refine.frame(fast).dots.length).toBe(0);
  });

  it("leaves the input image's gaps out of a paused split on the map", () => {
    const targetRefine = targetStory[4]!;
    const k = targetScene.record.steps.length - 1;
    const frame = targetRefine.frame(targetRefine.scrubber!.timeAt(k), {
      paused: true,
    });
    expect(frame.dots.map((dot) => dot.id)).toEqual([
      "samples-source",
      "samples-guess",
      "samples-exact",
      "split-source",
      "split-exact",
      "split-pin",
    ]);
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

  /** The target mesh's per-vertex RGBA tints at a slider position. */
  const tintsAt = (position: number): Float32Array =>
    refine
      .frame(scrubber.timeAt(position), { paused: true })
      .meshes.find((mesh) => mesh.id === "target")!.soup.tints!;

  it("tints the triangle being split orange", () => {
    const k = 5;
    const split = scene.record.steps[k]!.split.index;
    // Green channel: 0.62 for orange, 0.27 for the red error tint.
    expect(tintsAt(k)[12 * split + 1]).toBeGreaterThan(0.5);
  });

  it("fades the error tint as the mesh converges", () => {
    // Mean tint alpha of the triangles that aren't being split.
    const heat = (position: number) => {
      const tints = tintsAt(position);
      const split = scene.record.steps[position]!.split.index;
      const alphas = Array.from(
        { length: tints.length / 12 },
        (_, t) => tints[12 * t + 3]!,
      ).filter((_, t) => t !== split);
      return alphas.reduce((sum, alpha) => sum + alpha, 0) / alphas.length;
    };
    // The seed triangle that isn't split first still has the seed's error.
    expect(heat(0)).toBeCloseTo(0.3, 5);
    expect(heat(0)).toBeGreaterThan(heat(20));
    expect(heat(20)).toBeGreaterThan(heat(steps - 1));
  });

  it("clears the tint once the error is below the threshold", () => {
    const tints = refine
      .frame(refine.durationMs - 1e-6)
      .meshes.find((mesh) => mesh.id === "target")!.soup.tints!;
    for (let i = 3; i < tints.length; i += 4) {
      expect(tints[i]).toBeCloseTo(0, 3);
    }
  });

  it("only exists on the refinement step", () => {
    expect(
      story.filter((step) => step.scrubber).map((step) => step.id),
    ).toEqual(["refine"]);
  });
});

describe("seedPointPhrase", () => {
  it("names the image center and the middle of each edge", () => {
    expect(seedPointPhrase([0.5, 0.5])).toBe("at the center of the image");
    expect(seedPointPhrase([0.5, 0])).toBe(
      "at the middle of the image's top edge",
    );
    expect(seedPointPhrase([0.5, 1])).toBe(
      "at the middle of the image's bottom edge",
    );
    expect(seedPointPhrase([0, 0.5])).toBe(
      "at the middle of the image's left edge",
    );
    expect(seedPointPhrase([1, 0.5])).toBe(
      "at the middle of the image's right edge",
    );
  });

  it("names a triangle's center", () => {
    expect(seedPointPhrase([2 / 3, 1 / 3])).toBe(
      "at the center of one of the triangles",
    );
  });
});
