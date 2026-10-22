import { beforeAll, describe, expect, it } from "vitest";
import type { Frame } from "../src/animation/frame.js";
import type { StoryStep } from "../src/animation/story.js";
import { createStory } from "../src/animation/story.js";
import { landToCommon } from "../src/scene/land.js";
import { commonToSlide, IMAGE_BOX } from "../src/scene/layout.js";
import type { MeshScene } from "../src/scene/mesh.js";
import { makeProjection } from "../src/scene/projection.js";
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
  });

  it("numbers each sample in the image and up close", () => {
    const { labels } = end(4).hud;
    for (const place of ["image", "moved"]) {
      const numbers = labels
        .filter((l) => l.id.startsWith(`walk-${place}-`))
        .map((l) => l.text);
      expect(numbers, place).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    }
  });

  it("lists the samples at each edge of the strip in one label, as they crowd there", () => {
    const { labels } = end(4).hud;
    const strip = labels.filter((l) => l.id.startsWith("walk-raw-"));
    // The image's west half lands at the map's east edge, and vice versa.
    expect(strip.map((l) => [l.id, l.text])).toEqual([
      ["walk-raw-east-edge", "1, 2, 5, 6"],
      ["walk-raw-west-edge", "3, 4, 7, 8"],
    ]);
  });

  it("labels the center, where every walk starts", () => {
    const { labels } = end(4).hud;
    const center = labels.filter((l) => l.id.startsWith("walk-center"));
    expect(center.map((l) => l.text)).toEqual(["center", "center"]);
  });

  it("names the seam on each side: 180° for the copy to its west, -180° for this one", () => {
    const frame = end(4);
    const [seamX] = commonToSlide(frame.cameras.closeup!, [0, 0]);
    const west = frame.hud.labels.find((l) => l.id === "seam-west");
    const east = frame.hud.labels.find((l) => l.id === "seam-east");
    expect(west?.text).toBe("180°");
    expect(west?.align).toBe("right");
    expect(west!.x).toBeLessThan(seamX);
    expect(east?.text).toBe("-180°");
    expect(east?.align).toBe("left");
    expect(east!.x).toBeGreaterThan(seamX);
    expect(frame.hud.labels.some((l) => l.text.includes("="))).toBe(false);
  });

  it("links only the latest sample to where it moved, once the walk is done", () => {
    const leaders = end(4).lines.filter((l) => l.id.startsWith("leader-"));
    expect(leaders.map((l) => l.id)).toEqual(["leader-8"]);
    expect(leaders[0]?.view).toBe("slide");
  });

  it("fades a sample's link out as the next sample starts", () => {
    const step = story[4]!;
    // Each stop is where a sample starts: the second sample's is stops[1].
    const second = step.stops![1]!;
    const alphaOfFirst = (t: number) =>
      step.frame(t).lines.find((l) => l.id === "leader-1")?.color[3] ?? 0;
    expect(alphaOfFirst(second - 1)).toBeGreaterThan(0);
    expect(alphaOfFirst(second + 150)).toBeLessThan(alphaOfFirst(second - 1));
    expect(alphaOfFirst(second + 1000)).toBe(0);
  });

  it("draws each move dashed, unlike the walk's solid paths in the image", () => {
    const frame = end(4);
    const leader = frame.lines.find((l) => l.id === "leader-8");
    const paths = frame.lines.find((l) => l.id === "walk-paths");
    expect(leader?.dashed).toBe(true);
    expect(paths?.dashed).toBeFalsy();
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

  it("draws the probe's move dashed, unlike its solid trail", () => {
    const frame = end(5);
    const leader = frame.lines.find((l) => l.id === "probe-leader");
    const trail = frame.lines.find((l) => l.id === "probe-trail");
    expect(leader?.dashed).toBe(true);
    expect(trail?.dashed).toBeFalsy();
  });

  it("says what the reprojector projects, with the scene's own count", () => {
    const text = plainText(story[5]!);
    expect(text).toContain("four check points in each triangle");
    expect(text).toContain("320 times");
    const other = createStory(
      { ...scene, refinement: { ...scene.refinement, projections: 999 } },
      fakeImage(),
    );
    expect(plainText(other[5]!)).toContain("999 times");
  });

  it("says the sweeping probe is the explainer's, not the reprojector's", () => {
    expect(plainText(story[5]!)).toContain(
      "The probe here is the explainer's, not the reprojector's",
    );
    const name = end(5).hud.labels.find((l) => l.id === "probe-name");
    expect(name?.text).toBe("probe");
  });

  it("west of 180°, finds proj4's answer a whole world from the snapped point", () => {
    const [raw, snapped] = probeAt(0);
    expect(raw - snapped).toBeCloseTo(512, 0);
  });

  it("east of 180°, finds them in the same place", () => {
    const [raw, snapped] = probeAt(story[5]!.durationMs / 2);
    expect(raw).toBeCloseTo(snapped, 6);
  });
});

describe("step 7: mesh as usual", () => {
  it("ends on the 40-triangle mesh, in the strip and up close", () => {
    const meshes = end(6).meshes.filter((m) => m.id === "mesh");
    expect(meshes.map((m) => m.view).sort()).toEqual(["closeup", "strip"]);
    for (const mesh of meshes) {
      expect(mesh.soup.vertexCount).toBe(3 * 40);
    }
  });
});

/** Every x of a soup's corners. */
function soupXs(positions: Float32Array): number[] {
  return Array.from(positions).filter((_, i) => i % 2 === 0);
}

describe("step 8: cut at the world's edge", () => {
  it("ends with the cut mesh, its overhang moved one world over", () => {
    const clipped = end(7).meshes.find(
      (m) => m.id === "clipped" && m.view === "strip",
    );
    expect(clipped?.soup.vertexCount).toBe(3 * 60);
    const xs = soupXs(clipped!.soup.positions);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-3);
    expect(Math.max(...xs)).toBeLessThanOrEqual(512 + 1e-3);
    expect(Math.max(...xs)).toBeGreaterThan(503);
  });

  it("draws the cut in the image along the 180° meridian", async () => {
    const { fns, toLngLat } = await makeProjection(fakeImage());
    const cut = end(7).lines.find((l) => l.id === "cut");
    expect(cut?.view).toBe("slide");
    const points = cut!.paths.flat();
    expect(points.length).toBeGreaterThan(4);
    for (const [x, y] of points) {
      const u = (x - IMAGE_BOX.x) / IMAGE_BOX.width;
      const v = (y - IMAGE_BOX.y) / IMAGE_BOX.height;
      const [lng] = toLngLat(...fns.forwardTransform(u * 42, v * 42));
      expect(180 - Math.abs(lng)).toBeLessThan(0.5);
    }
  });
});

describe("step 9: on the map", () => {
  it("draws the west copy beside the seam, so the moved part meets it", () => {
    const copy = end(8).meshes.find(
      (m) => m.id === "copy-west" && m.view === "closeup",
    );
    const xs = soupXs(copy!.soup.positions);
    expect(Math.min(...xs)).toBeCloseTo(-512, 3);
    expect(xs.some((x) => Math.abs(x - -8.82) < 0.01)).toBe(true);
  });
});

/** A description's text, without its emphasis and links. */
function plainText(step: StoryStep): string {
  return step.description
    .map((run) => (typeof run === "string" ? run : run.text))
    .join("");
}

describe("titles", () => {
  it("name the nine steps, in order", () => {
    expect(story.map((step) => step.title)).toEqual([
      "An image across 180°",
      "Two triangles",
      "Project the corners",
      "Refining can't fix it",
      "Walk to the corners",
      "Snap every point",
      "Mesh as usual",
      "Cut at the world's edge",
      "On the map",
    ]);
  });
});

describe("descriptions", () => {
  it("describe steps 3-8 with the scene's own numbers", () => {
    const shift = (p: [number, number], dx: number): [number, number] => [
      p[0] + dx,
      p[1],
    ];
    const corners = Object.fromEntries(
      Object.entries(scene.corners).map(([id, c]) => [
        id,
        { ...c, raw: shift(c.raw, 2), unwrapped: shift(c.unwrapped, -2) },
      ]),
    ) as MeshScene["corners"];
    const last = scene.plain[scene.plain.length - 1]!;
    const changed: MeshScene = {
      ...scene,
      center: { ...scene.center, position: shift(scene.center.position, 1) },
      corners,
      plain: [
        ...scene.plain.slice(0, -1),
        { ...last, triangles: last.triangles.slice(0, 300), maxError: 999 },
      ],
      probe: scene.probe.map((s) => ({
        ...s,
        raw: shift(s.raw, 2),
        snapped: shift(s.snapped, -2),
      })),
      refinement: { ...scene.refinement, projections: 999 },
      mesh: { ...scene.mesh, triangles: scene.mesh.triangles.slice(0, 90) },
      crossing: scene.crossing.slice(0, 5),
      clipped: {
        ...scene.clipped,
        triangles: scene.clipped.triangles.slice(0, 150),
      },
    };
    const other = createStory(changed, fakeImage());
    for (let i = 2; i <= 7; i++) {
      expect(plainText(other[i]!), `step ${i + 1}`).not.toBe(
        plainText(story[i]!),
      );
    }
  });
});

describe("final review fixes", () => {
  it("step 8 says the layer keeps each tile inside one world, not that the map can't draw it", () => {
    const text = plainText(story[7]!);
    expect(text).not.toContain("can't draw");
    expect(text).toContain("inside one world");
  });

  it("step 6 ends with the probe's whole trail", () => {
    const trail = end(5).lines.find((l) => l.id === "probe-trail");
    expect(trail?.paths[0]).toHaveLength(scene.probe.length);
  });

  it("step 1 says the meridian slants across the image, as it looks", () => {
    expect(plainText(story[0]!)).not.toContain("curves");
    expect(plainText(story[0]!)).toContain("slant");
  });

  it("step 5 gives both west corners' raw x", () => {
    expect(plainText(story[4]!)).toContain("instead of 503 and 504");
  });

  it("step 7 says every layer measures on the map, and why it must here", () => {
    expect(plainText(story[6]!)).toContain("as every layer now does");
  });

  it("step 4 builds each snapshot's triangles once, not every frame", () => {
    const soupAt = (time: number) =>
      story[3]!.frame(time).meshes.find((m) => m.id === "plain")!.soup;
    expect(soupAt(10)).toBe(soupAt(20));
  });
});

describe("beats", () => {
  /** Step `index`'s frame at its `beat`th stop. */
  function atStop(index: number, beat: number) {
    const step = story[index]!;
    return step.frame(step.stops![beat]!);
  }
  const points = (frame: Frame, id: string) =>
    frame.dots.find((d) => d.id === id)?.points.length ?? 0;

  it("step 5 stops after the split and after each sample but the last", () => {
    expect(story[4]!.stops).toHaveLength(8);
    expect(points(atStop(4, 0), "walk-moved")).toBe(0);
    expect(points(atStop(4, 1), "walk-moved")).toBe(1);
    expect(points(atStop(4, 2), "walk-moved")).toBe(2);
  });

  it("step 5 shows a sample in the image before the map", () => {
    const step = story[4]!;
    const early = step.frame(step.stops![0]! + 200);
    expect(points(early, "walk-image")).toBe(1);
    expect(points(early, "walk-raw")).toBe(0);
    expect(points(early, "walk-moved")).toBe(0);
  });

  it("step 3 stops once the corners land, before the triangles stretch", () => {
    const frame = atStop(2, 0);
    expect(frame.dots.find((d) => d.id === "corners")?.view).toBe("world");
    expect(frame.meshes.find((m) => m.id === "plain")).toBeUndefined();
  });

  it("step 6 stops on each side of 180°", () => {
    const xs = (frame: Frame) =>
      ["probe-raw", "probe-snapped"].map(
        (id) => frame.dots.find((d) => d.id === id)!.points[0]![0],
      );
    const [westRaw, westSnapped] = xs(atStop(5, 0));
    expect(westRaw - westSnapped).toBeCloseTo(512, 0);
    const [eastRaw, eastSnapped] = xs(atStop(5, 1));
    expect(eastRaw).toBeCloseTo(eastSnapped, 6);
  });

  it("step 8 stops before the cut, and again before the move", () => {
    expect(atStop(7, 0).lines.find((l) => l.id === "cut")).toBeUndefined();
    const cut = atStop(7, 1);
    expect(cut.lines.find((l) => l.id === "cut")).toBeDefined();
    const moving = cut.meshes.find((m) => m.id === "clipped-moving");
    const xs = Array.from(moving!.soup.positions).filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeLessThan(0);
  });
});

describe("beats hold on finished frames", () => {
  it("step 5's close-up has fully faded in at its first stop", () => {
    const step = story[4]!;
    const frame = step.frame(step.stops![0]!);
    const edges = frame.lines.find(
      (l) => l.id === "world-edges" && l.view === "closeup",
    );
    expect(edges?.color[3]).toBe(Math.round(255 * 0.8));
  });
});

describe("the real map", () => {
  // An island at 179°E-179.5°E, 51°N-52°N, under the image's west part.
  const land = landToCommon({
    features: [
      {
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [179, 51],
              [179.5, 51],
              [179.5, 52],
              [179, 52],
              [179, 51],
            ],
          ],
        },
      },
    ],
  });
  const landStory = () => createStory(scene, fakeImage(), land);
  const polygon = (frame: Frame, id: string, view: string) =>
    frame.polygons.find((p) => p.id === id && p.view === view);

  it("draws land under the world map", () => {
    const step = landStory()[0]!;
    const drawn = polygon(step.frame(step.durationMs), "land", "world");
    expect(drawn?.under).toBe(true);
    expect(drawn?.polygons.length).toBeGreaterThan(0);
  });

  it("draws coastlines over everything up close, in every step that shows it", () => {
    const steps = landStory();
    for (const index of [4, 5, 6, 7, 8]) {
      const step = steps[index]!;
      const coast = polygon(step.frame(step.durationMs), "coast", "closeup");
      expect(coast?.under, `step ${index + 1}`).toBeFalsy();
      expect(coast?.line, `step ${index + 1}`).toBeDefined();
    }
  });

  it("puts land just west of 180° west of the seam up close", () => {
    const step = landStory()[6]!;
    const coast = polygon(step.frame(step.durationMs), "coast", "closeup");
    const xs = coast!.polygons[0]![0]!.map(([x]) => x);
    expect(Math.max(...xs)).toBeLessThan(0);
  });

  it("draws no land when there is none", () => {
    expect(end(0).polygons).toHaveLength(0);
  });
});
