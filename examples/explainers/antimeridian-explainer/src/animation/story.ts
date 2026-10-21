import type { Camera } from "../scene/layout.js";
import {
  CLOSEUP_BOX,
  cameraForBounds,
  commonToSlide,
  STRIP_BOX,
  uvToSlide,
} from "../scene/layout.js";
import type { SourceImage } from "../scene/load.js";
import type { MeshScene } from "../scene/mesh.js";
import type { Frame } from "./frame.js";
import { emptyFrame } from "./frame.js";
import { createSoup } from "./soup.js";

/** A run of description text: plain, emphasised, or a link. */
export type TextRun =
  | string
  | { text: string; emphasis: true }
  | { text: string; href: string };

/** One step of the story: a title, a description, and its frames over time. */
export type StoryStep = {
  /** Stable id. */
  id: string;
  /** Title, shown after the step number. */
  title: string;
  /** Description under the panels. */
  description: TextRun[];
  /** How long the step animates, in ms; 0 for a still step. */
  durationMs: number;
  /** What to draw `timeMs` into the step. */
  frame(timeMs: number): Frame;
};

/** The bounds `[minX, minY, maxX, maxY]` of flat `[x, y, ...]` positions. */
function boundsOf(
  positions: ArrayLike<number>,
): [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < positions.length; i += 2) {
    minX = Math.min(minX, positions[i]!);
    maxX = Math.max(maxX, positions[i]!);
    minY = Math.min(minY, positions[i + 1]!);
    maxY = Math.max(maxY, positions[i + 1]!);
  }
  return [minX, minY, maxX, maxY];
}

/** The story: placeholder until the steps are written. */
export function createStory(
  scene: MeshScene,
  _image: SourceImage,
): StoryStep[] {
  const { mesh } = scene;
  const meshBounds = boundsOf(mesh.positions);
  const closeup = cameraForBounds(CLOSEUP_BOX, meshBounds, 40);
  const strip: Camera = {
    rect: STRIP_BOX,
    center: [256, closeup.center[1]],
    scale: STRIP_BOX.width / 544,
  };
  const slidePositions: number[] = [];
  for (let i = 0; i < mesh.uvs.length; i += 2) {
    slidePositions.push(...uvToSlide([mesh.uvs[i]!, mesh.uvs[i + 1]!]));
  }
  const raw = scene.corners.nw.raw;
  const snapped = scene.corners.nw.unwrapped;
  return [
    {
      id: "spike",
      title: "Spike",
      description: ["Views, clipping and leader lines."],
      durationMs: 0,
      frame: () => {
        const frame = emptyFrame();
        frame.cameras = { strip, closeup };
        frame.meshes.push(
          {
            id: "image",
            view: "slide",
            soup: createSoup({
              triangles: mesh.triangles,
              positions: slidePositions,
              uvs: mesh.uvs,
            }),
            edgeColor: [255, 255, 255, 160],
            edgeWidth: 1,
            opacity: 1,
          },
          {
            id: "mesh",
            view: "closeup",
            soup: createSoup(mesh),
            edgeColor: [255, 255, 255, 200],
            edgeWidth: 1,
            opacity: 1,
          },
          {
            id: "mesh",
            view: "strip",
            soup: createSoup(mesh),
            edgeColor: [255, 255, 255, 0],
            edgeWidth: 1,
            opacity: 1,
          },
        );
        frame.lines.push(
          {
            id: "edges",
            view: "strip",
            paths: [
              [
                [0, 200],
                [0, 500],
              ],
              [
                [512, 200],
                [512, 500],
              ],
            ],
            color: [139, 148, 158, 255],
            width: 1,
            dashed: true,
          },
          {
            id: "leader",
            view: "slide",
            paths: [
              [commonToSlide(strip, raw), commonToSlide(closeup, snapped)],
            ],
            color: [230, 237, 243, 160],
            width: 1.5,
          },
        );
        frame.dots.push(
          {
            id: "raw",
            view: "strip",
            points: [raw],
            color: [240, 100, 85, 255],
            radius: 6,
          },
          {
            id: "snapped",
            view: "closeup",
            points: [snapped],
            color: [90, 220, 130, 255],
            radius: 6,
          },
        );
        return frame;
      },
    },
  ];
}
