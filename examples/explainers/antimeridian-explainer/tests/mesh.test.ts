import { makeUnwrappedReprojectionFns } from "@developmentseed/deck.gl-raster/internal/make-unwrapped-reprojection-fns.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { MeshScene } from "../src/scene/mesh.js";
import { buildMeshScene, CORNER_IDS, cornerPixels } from "../src/scene/mesh.js";
import type { Projection } from "../src/scene/projection.js";
import { makeProjection } from "../src/scene/projection.js";
import { fakeImage } from "./fake-image.js";

let projection: Projection;
let scene: MeshScene;

beforeAll(async () => {
  projection = await makeProjection(fakeImage());
  scene = buildMeshScene(projection, { width: 42, height: 42 });
});

/** Every x of a flat [x, y, ...] array. */
function xsOf(positions: ArrayLike<number>): number[] {
  return Array.from(positions).filter((_, i) => i % 2 === 0);
}

describe("buildMeshScene: the corners", () => {
  it("projects the corners into one world: the west ones at its east edge", () => {
    const raw = CORNER_IDS.map((id) => scene.corners[id].raw[0]);
    expect(raw[0]).toBeCloseTo(503.18, 2);
    expect(raw[1]).toBeCloseTo(10.18, 2);
    expect(raw[2]).toBeCloseTo(503.89, 2);
    expect(raw[3]).toBeCloseTo(7.96, 2);
  });

  it("unwraps the west corners past the world's west edge", () => {
    expect(scene.corners.nw.unwrapped[0]).toBeCloseTo(-8.82, 2);
    expect(scene.corners.sw.unwrapped[0]).toBeCloseTo(-8.11, 2);
    expect(scene.corners.ne.unwrapped[0]).toBeCloseTo(10.18, 2);
  });
});

describe("buildMeshScene: the walks", () => {
  it("samples each walk at its midpoint and its corner", () => {
    for (const id of CORNER_IDS) {
      expect(scene.walks[id].samples.map((s) => s.t)).toEqual([0.5, 1]);
    }
    const [mid, end] = scene.walks.nw.samples;
    expect(mid!.raw).toBeCloseTo(507.95, 2);
    expect(mid!.x).toBeCloseTo(-4.05, 2);
    expect(end!.raw).toBeCloseTo(503.18, 2);
    expect(end!.x).toBeCloseTo(-8.82, 2);
  });

  it("ends each walk where the wrapped functions put its corner", () => {
    const { fns } = projection;
    const wrapped = makeUnwrappedReprojectionFns(fns, {
      width: 42,
      height: 42,
      period: 512,
    });
    const pixels = cornerPixels(42, 42);
    for (const id of CORNER_IDS) {
      const [x] = wrapped.forwardReproject(
        ...fns.forwardTransform(...pixels[id]),
      );
      expect(scene.walks[id].end).toBeCloseTo(x, 4);
    }
  });
});

describe("buildMeshScene: the meshes", () => {
  it("stalls refining the plain projection, with a triangle across the world", () => {
    const last = scene.plain[scene.plain.length - 1]!;
    expect(last.triangles.length / 3).toBe(20001);
    expect(last.maxError).toBeGreaterThan(600);
    let widest = 0;
    for (let t = 0; t < last.triangles.length; t += 3) {
      const xs = [0, 1, 2].map(
        (k) => last.positions[2 * last.triangles[t + k]!]!,
      );
      widest = Math.max(widest, Math.max(...xs) - Math.min(...xs));
    }
    expect(widest).toBeGreaterThan(256);
  });

  it("meshes the snapped projection in 40 triangles", () => {
    expect(scene.mesh.triangles.length / 3).toBe(40);
  });

  it("cuts the 10 triangles that cross x 0, leaving 60 inside one world", () => {
    expect(scene.crossing).toHaveLength(10);
    expect(scene.clipped.triangles.length / 3).toBe(60);
    const xs = xsOf(scene.clipped.positions);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(512);
  });
});

describe("buildMeshScene: the probe and the meridian", () => {
  it("jumps a world in proj4's answer, but not once snapped", () => {
    let rawJump = 0;
    let snappedStep = 0;
    for (let i = 1; i < scene.probe.length; i++) {
      const a = scene.probe[i - 1]!;
      const b = scene.probe[i]!;
      rawJump = Math.max(rawJump, Math.abs(b.raw[0] - a.raw[0]));
      snappedStep = Math.max(
        snappedStep,
        Math.abs(b.snapped[0] - a.snapped[0]),
      );
    }
    expect(rawJump).toBeGreaterThan(256);
    expect(snappedStep).toBeLessThan(1);
  });

  it("traces the 180° meridian through the image", () => {
    const { fns, toLngLat } = projection;
    expect(scene.meridian.length).toBeGreaterThan(10);
    for (const [u, v] of scene.meridian) {
      const [lng] = toLngLat(...fns.forwardTransform(u * 42, v * 42));
      expect(180 - Math.abs(lng)).toBeLessThan(1e-6);
    }
  });
});
