import { describe, expect, it } from "vitest";
import type { Frame, ImageId } from "../src/animation/frame.js";
import { emptyFrame } from "../src/animation/frame.js";
import type { Assets } from "../src/render/frame-to-layers.js";
import { frameToLayers } from "../src/render/frame-to-layers.js";

const rect = { x: 10, y: 20, width: 30, height: 40 };

/** Assets whose images and textures are stand-ins: layers are only built. */
function fakeAssets(): Assets {
  const canvas = {} as HTMLCanvasElement;
  const texture = {} as never;
  const band = { texture, uvTransform: [0, 0, 1, 1] as const };
  const inputs = {
    bands: { b04: band, b11: band, b01: band },
    size: [4, 4] as [number, number],
  };
  return {
    images: new Proxy({} as Record<ImageId, HTMLCanvasElement>, {
      get: () => canvas,
    }),
    composites: { overview: inputs, tile: inputs },
  };
}

describe("frameToLayers", () => {
  it("draws images, then composites, then outlines, then dots, keeping ids", () => {
    const frame: Frame = {
      ...emptyFrame(),
      dots: [
        {
          id: "probe",
          points: [[1, 2]],
          color: [255, 255, 255, 255],
          radius: 3,
        },
      ],
      polygons: [
        {
          id: "grid",
          rings: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
            ],
          ],
          line: [255, 0, 0, 255],
        },
      ],
      composites: [{ id: "scene", source: "overview", rect, opacity: 1 }],
      bitmaps: [{ id: "b04", image: "b04-overview", rect, opacity: 1 }],
    };
    const ids = frameToLayers(frame, fakeAssets()).map((layer) => layer.id);
    expect(ids).toEqual(["b04", "scene", "grid", "probe"]);
  });
});
