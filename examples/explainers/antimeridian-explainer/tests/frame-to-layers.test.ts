import type { Texture } from "@luma.gl/core";
import { describe, expect, it } from "vitest";
import type { Frame } from "../src/animation/frame.js";
import { emptyFrame } from "../src/animation/frame.js";
import { createSoup } from "../src/animation/soup.js";
import { frameToLayers, layerFilter } from "../src/render/frame-to-layers.js";

const assets = { texture: {} as Texture };

const soup = createSoup({
  triangles: [0, 1, 2],
  positions: [0, 0, 1, 0, 0, 1],
  uvs: [0, 0, 1, 0, 0, 1],
});

describe("frameToLayers", () => {
  it("prefixes each layer's id with its view, and draws meshes, lines, then dots", () => {
    const frame: Frame = {
      ...emptyFrame(),
      dots: [
        {
          id: "probe",
          view: "strip",
          points: [[1, 2]],
          color: [255, 0, 0, 255],
          radius: 4,
        },
      ],
      lines: [
        {
          id: "edge",
          view: "slide",
          paths: [
            [
              [0, 0],
              [1, 1],
            ],
          ],
          color: [255, 255, 255, 255],
          width: 2,
        },
      ],
      meshes: [
        {
          id: "mesh",
          view: "closeup",
          soup,
          edgeColor: [255, 255, 255, 255],
          edgeWidth: 1,
          opacity: 1,
        },
      ],
    };
    const ids = frameToLayers(frame, assets).map((layer) => layer.id);
    expect(ids).toEqual([
      "closeup:mesh-mesh",
      "slide:line-edge",
      "strip:dots-probe",
    ]);
  });
});

describe("layerFilter", () => {
  it("draws a layer only in the view its id names", () => {
    const layer = { id: "strip:mesh-mesh" } as never;
    expect(layerFilter({ layer, viewport: { id: "strip" } as never })).toBe(
      true,
    );
    expect(layerFilter({ layer, viewport: { id: "closeup" } as never })).toBe(
      false,
    );
  });
});

describe("frameToLayers: land", () => {
  it("draws land under everything, and coastlines over the meshes", () => {
    const ring: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    const frame: Frame = {
      ...emptyFrame(),
      meshes: [
        {
          id: "mesh",
          view: "closeup",
          soup,
          edgeColor: [0, 0, 0, 0],
          edgeWidth: 1,
          opacity: 1,
        },
      ],
      polygons: [
        {
          id: "coast",
          view: "closeup",
          polygons: [[ring]],
          line: [255, 255, 255, 255],
        },
        {
          id: "land",
          view: "closeup",
          polygons: [[ring]],
          fill: [33, 38, 45, 255],
          under: true,
        },
      ],
    };
    const ids = frameToLayers(frame, assets).map((layer) => layer.id);
    expect(ids).toEqual([
      "closeup:polygons-land",
      "closeup:mesh-mesh",
      "closeup:polygons-coast",
    ]);
  });
});
