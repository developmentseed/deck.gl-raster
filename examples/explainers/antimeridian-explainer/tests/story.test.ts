import { beforeAll, describe, expect, it } from "vitest";
import type { Frame } from "../src/animation/frame.js";
import type { StoryStep } from "../src/animation/story.js";
import { createStory } from "../src/animation/story.js";
import type { MeshScene } from "../src/scene/mesh.js";
import { fakeImage } from "./fake-image.js";
import { fakeMeshScene } from "./fake-scene.js";

let scene: MeshScene;
let story: StoryStep[];

beforeAll(async () => {
  scene = await fakeMeshScene();
  story = createStory(scene, fakeImage());
});

/** A step's last frame. */
function end(index: number): Frame {
  const step = story[index]!;
  return step.frame(step.durationMs);
}

/** The x range a camera shows, `[left, right]`. */
function xRange(frame: Frame, view: "world" | "strip" | "closeup") {
  const camera = frame.cameras[view]!;
  const half = camera.rect.width / 2 / camera.scale;
  return [camera.center[0] - half, camera.center[0] + half];
}

describe("step 1: an image across 180°", () => {
  it("shows the whole world, a little past both edges", () => {
    const [left, right] = xRange(end(0), "world");
    expect(left).toBeCloseTo(-16, 6);
    expect(right).toBeCloseTo(528, 6);
  });

  it("draws the image as stored, and its footprint on the map", () => {
    const meshes = end(0).meshes.map((m) => `${m.view}:${m.id}`);
    expect(meshes).toContain("slide:image");
    expect(meshes).toContain("world:footprint");
  });
});

describe("step 2: two triangles", () => {
  it("draws the reprojector's two starting triangles over the image", () => {
    const seed = end(1).meshes.find((m) => m.id === "seed");
    expect(seed?.view).toBe("slide");
    expect(seed?.soup.vertexCount).toBe(6);
  });
});

/** Each triangle's width along x, from a mesh's soup (3 corners per triangle). */
function triangleWidths(positions: Float32Array): number[] {
  const widths: number[] = [];
  for (let i = 0; i < positions.length; i += 6) {
    const xs = [positions[i]!, positions[i + 2]!, positions[i + 4]!];
    widths.push(Math.max(...xs) - Math.min(...xs));
  }
  return widths;
}

describe("step 3: project the corners", () => {
  it("lands the corners where proj4 puts them, in one world", () => {
    const corners = end(2).dots.find((d) => d.id === "corners");
    expect(corners?.view).toBe("world");
    const xs = corners!.points.map(([x]) => x);
    expect(xs[0]).toBeCloseTo(503.18, 2);
    expect(xs[1]).toBeCloseTo(10.18, 2);
    expect(xs[2]).toBeCloseTo(503.89, 2);
    expect(xs[3]).toBeCloseTo(7.96, 2);
  });

  it("stretches both triangles across the world", () => {
    const seed = end(2).meshes.find((m) => m.id === "plain");
    expect(seed?.view).toBe("world");
    const widths = triangleWidths(seed!.soup.positions);
    expect(widths).toHaveLength(2);
    for (const width of widths) {
      expect(width).toBeGreaterThan(256);
    }
  });
});

describe("step 4: refining can't fix it", () => {
  it("ends on the mesh where refinement gives up", () => {
    const mesh = end(3).meshes.find((m) => m.id === "plain");
    expect(mesh?.soup.vertexCount).toBe(3 * 20001);
  });

  it("counts triangles and error from the scene, not from fixed numbers", () => {
    const last = scene.plain.length - 1;
    const changed = {
      ...scene,
      plain: scene.plain.map((snapshot, i) =>
        i === last ? { ...snapshot, maxError: 123.4 } : snapshot,
      ),
    };
    const step = createStory(changed, fakeImage())[3]!;
    const texts = step.frame(step.durationMs).hud.labels.map((l) => l.text);
    expect(texts.join(" ")).toContain("20,001 triangles");
    expect(texts.join(" ")).toContain("123 px");
  });
});

describe("step 5: walk to the corners", () => {
  it("splits the map into the world strip and the close-up", () => {
    const { cameras } = end(4);
    expect(cameras.world).toBeUndefined();
    expect(cameras.strip).toBeDefined();
    expect(cameras.closeup).toBeDefined();
  });

  it("shows each sample raw in the strip and moved in the close-up, linked", () => {
    const frame = end(4);
    const raw = frame.dots.find((d) => d.id === "walk-raw");
    const moved = frame.dots.find((d) => d.id === "walk-moved");
    expect(raw?.view).toBe("strip");
    expect(moved?.view).toBe("closeup");
    expect(raw?.points).toHaveLength(8);
    expect(moved?.points).toHaveLength(8);
    expect(raw!.points[1]![0]).toBeCloseTo(503.18, 2);
    expect(moved!.points[1]![0]).toBeCloseTo(-8.82, 2);
    const leaders = frame.lines.find((l) => l.id === "leaders");
    expect(leaders?.view).toBe("slide");
    expect(leaders?.paths).toHaveLength(8);
  });
});

describe("frames", () => {
  it("depend only on the step and the time", () => {
    const before = story[4]!.frame(1500);
    for (const step of story) {
      step.frame(0);
      step.frame(step.durationMs / 2);
      step.frame(step.durationMs);
    }
    expect(story[4]!.frame(1500)).toEqual(before);
  });
});

describe("step 6: snap every point", () => {
  /** The probe's raw and snapped x at `time` into step 6. */
  function probeAt(time: number) {
    const frame = story[5]!.frame(time);
    const raw = frame.dots.find((d) => d.id === "probe-raw");
    const snapped = frame.dots.find((d) => d.id === "probe-snapped");
    expect(raw?.view).toBe("strip");
    expect(snapped?.view).toBe("closeup");
    return [raw!.points[0]![0], snapped!.points[0]![0]];
  }

  it("west of 180°, finds proj4's answer a whole world from the snapped point", () => {
    const [raw, snapped] = probeAt(0);
    expect(raw - snapped).toBeCloseTo(512, 0);
  });

  it("east of 180°, finds them in the same place", () => {
    const [raw, snapped] = probeAt(story[5]!.durationMs / 2);
    expect(raw).toBeCloseTo(snapped, 6);
  });
});
