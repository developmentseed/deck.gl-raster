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
