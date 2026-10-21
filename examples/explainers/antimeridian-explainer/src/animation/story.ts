import type { Mesh2D } from "@developmentseed/deck.gl-raster/internal/clip-mesh-to-world.js";
import type { TriangleSoup } from "../layers/triangle-soup.js";
import { PERIOD } from "../scene/constants.js";
import type { Camera } from "../scene/layout.js";
import {
  commonToSlide,
  IMAGE_BOX,
  MAP_BOX,
  uvToSlide,
} from "../scene/layout.js";
import type { SourceImage } from "../scene/load.js";
import type { MeshScene } from "../scene/mesh.js";
import type { Frame, Label, LineDraw, Rgba, ViewId } from "./frame.js";
import { emptyFrame } from "./frame.js";
import { progress } from "./math.js";
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

// GitHub's dark palette, like the slide.
const MUTED = "#8b949e";
const WHITE: Rgba = [230, 237, 243, 255];
/** Graticule lines. */
const GRID: Rgba = [139, 148, 158, 70];
/** The 180° meridian. */
const MERIDIAN: Rgba = [255, 166, 87, 255];

/** How far past each world edge the whole-world framing shows, in common units. */
const WORLD_MARGIN = 16;

/** Common-space x of a longitude (one world is 0-512, from -180° to 180°). */
function xOfLongitude(lng: number): number {
  return ((lng + 180) / 360) * PERIOD;
}

/** Common-space y of a latitude, as Web Mercator places it. */
function yOfLatitude(lat: number): number {
  const phi = (lat * Math.PI) / 180;
  return (
    PERIOD / 2 +
    (PERIOD / (2 * Math.PI)) * Math.log(Math.tan(Math.PI / 4 + phi / 2))
  );
}

/** A graticule every 30° of longitude and latitude, under a map view. */
function graticule(view: ViewId, opacity: number): LineDraw {
  const paths: [number, number][][] = [];
  const south = yOfLatitude(-80);
  const north = yOfLatitude(80);
  for (let lng = -150; lng <= 150; lng += 30) {
    const x = xOfLongitude(lng);
    paths.push([
      [x, south],
      [x, north],
    ]);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = yOfLatitude(lat);
    paths.push([
      [0, y],
      [PERIOD, y],
    ]);
  }
  return {
    id: "graticule",
    view,
    paths,
    color: withAlpha(GRID, opacity),
    width: 1,
    under: true,
  };
}

/** RGBA with its alpha scaled by `opacity`. */
function withAlpha([r, g, b, a]: Rgba, opacity: number): Rgba {
  return [r, g, b, Math.round(a * opacity)];
}

/** A CSS color from an RGBA color. */
function css([r, g, b]: Rgba): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** A HUD label, with the defaults most labels use. */
function label(
  id: string,
  text: string,
  at: [number, number],
  options: Partial<Pick<Label, "align" | "color" | "opacity" | "size">> = {},
): Label {
  return {
    id,
    text,
    x: at[0],
    y: at[1],
    align: options.align ?? "center",
    color: options.color ?? MUTED,
    opacity: options.opacity ?? 1,
    size: options.size,
  };
}

/** A mesh's triangles, placed in the image box by their texture coordinates. */
function imageSoup(mesh: {
  triangles: ArrayLike<number>;
  uvs: ArrayLike<number>;
}): TriangleSoup {
  const positions: number[] = [];
  for (let i = 0; i < mesh.uvs.length; i += 2) {
    positions.push(...uvToSlide([mesh.uvs[i]!, mesh.uvs[i + 1]!]));
  }
  return createSoup({ triangles: mesh.triangles, positions, uvs: mesh.uvs });
}

/** A mesh's triangles at their positions in common space, moved `dx` along x. */
function mapSoup(mesh: Mesh2D | Snapshot, dx = 0): TriangleSoup {
  const positions =
    dx === 0
      ? mesh.positions
      : Array.from(mesh.positions, (value, i) =>
          i % 2 === 0 ? value + dx : value,
        );
  return createSoup({
    triangles: mesh.triangles,
    positions,
    uvs: mesh.uvs,
  });
}

type Snapshot = MeshScene["plain"][number];

/** The whole image as one quad, for drawing it as stored. */
const IMAGE_QUAD = {
  triangles: [0, 1, 2, 0, 2, 3],
  uvs: [0, 0, 1, 0, 1, 1, 0, 1],
};

/** The story: nine steps that follow one image's mesh across 180°. */
export function createStory(
  scene: MeshScene,
  _image: SourceImage,
): StoryStep[] {
  const centerY = scene.center.position[1];
  const worldWidth = PERIOD + 2 * WORLD_MARGIN;
  /** The whole world, in the whole map box (steps 1-4). */
  const worldCamera: Camera = {
    rect: MAP_BOX,
    center: [PERIOD / 2, centerY],
    scale: MAP_BOX.width / worldWidth,
  };
  const imageSoupWhole = imageSoup(IMAGE_QUAD);
  const meridianPath = scene.meridian.map((uv) => uvToSlide(uv));

  /** The world's edges, dashed, in a map view: both are the 180° meridian. */
  const worldEdges = (
    view: ViewId,
    camera: Camera,
    opacity: number,
  ): LineDraw => {
    const halfHeight = camera.rect.height / 2 / camera.scale;
    const top = camera.center[1] + halfHeight;
    const bottom = camera.center[1] - halfHeight;
    return {
      id: "world-edges",
      view,
      paths: [0, PERIOD].map((x) => [
        [x, bottom],
        [x, top],
      ]),
      color: withAlpha(MERIDIAN, 0.8 * opacity),
      width: 1.5,
      dashed: true,
      under: true,
    };
  };

  /** Labels for the world's edges, above a map view. */
  const worldEdgeLabels = (camera: Camera, opacity: number): Label[] => {
    const top = camera.rect.y - 14;
    return [
      label("edge-west", "-180°", [commonToSlide(camera, [0, 0])[0], top], {
        color: css(MERIDIAN),
        opacity,
        size: 18,
      }),
      label("edge-east", "180°", [commonToSlide(camera, [PERIOD, 0])[0], top], {
        color: css(MERIDIAN),
        opacity,
        size: 18,
      }),
    ];
  };

  /** The image as stored, with the 180° meridian through it. */
  const pushImage = (frame: Frame, opacity: number) => {
    frame.meshes.push({
      id: "image",
      view: "slide",
      soup: imageSoupWhole,
      edgeColor: [0, 0, 0, 0],
      edgeWidth: 1,
      opacity,
    });
    frame.lines.push({
      id: "meridian",
      view: "slide",
      paths: [meridianPath],
      color: withAlpha(MERIDIAN, opacity),
      width: 2,
      dashed: true,
    });
    const top = meridianPath[0];
    if (top) {
      frame.hud.labels.push(
        label("meridian", "180°", [top[0], IMAGE_BOX.y - 18], {
          color: css(MERIDIAN),
          opacity,
          size: 18,
        }),
      );
    }
    frame.hud.labels.push(
      label(
        "image-title",
        "The image as stored · UTM zone 60N",
        [
          IMAGE_BOX.x + IMAGE_BOX.width / 2,
          IMAGE_BOX.y + IMAGE_BOX.height + 34,
        ],
        { opacity, size: 22 },
      ),
    );
  };

  /** The whole-world map, with its edges (steps 1-4). */
  const pushWorld = (frame: Frame, opacity: number) => {
    frame.cameras.world = worldCamera;
    frame.lines.push(
      graticule("world", opacity),
      worldEdges("world", worldCamera, opacity),
    );
    frame.hud.labels.push(
      ...worldEdgeLabels(worldCamera, opacity),
      label(
        "map-title",
        "The map · Web Mercator, one world wide",
        [MAP_BOX.x + MAP_BOX.width / 2, MAP_BOX.y + MAP_BOX.height + 34],
        { opacity, size: 22 },
      ),
    );
  };

  /** Step 1: the image, the meridian through it, and where it belongs. */
  const imageStep: StoryStep = {
    id: "image",
    title: "An image across 180°",
    description: [
      "An image in UTM zone 60N, 42 x 42 pixels of 20 km, over the Bering Sea. The 180° meridian curves through it. On a Web Mercator map, 180° is both edges of the world, so the image belongs at both: its west part at the map's east edge, its east part at the west edge.",
    ],
    durationMs: 1600,
    frame: (t) => {
      const frame = emptyFrame();
      const fadeIn = progress(t, 0, 600);
      pushImage(frame, fadeIn);
      pushWorld(frame, progress(t, 400, 600));
      frame.meshes.push({
        id: "footprint",
        view: "world",
        soup: mapSoup(scene.clipped),
        edgeColor: [0, 0, 0, 0],
        edgeWidth: 1,
        opacity: progress(t, 900, 600),
      });
      frame.hud.caption = "One image, at both edges of the map";
      return frame;
    },
  };

  /** Step 2: the reprojector starts from two triangles over the image. */
  const seedSoup = imageSoup({
    triangles: scene.refinement.seedTriangles,
    uvs: scene.refinement.uvs,
  });
  const seedStep: StoryStep = {
    id: "seed",
    title: "Two triangles",
    description: [
      "To draw an image on the map, deck.gl-raster cuts it into triangles, places each corner exactly, and lets the GPU stretch the image in between. Like every image, this one starts as two triangles.",
    ],
    durationMs: 1200,
    frame: (t) => {
      const frame = emptyFrame();
      pushImage(frame, 1);
      pushWorld(frame, 1);
      frame.meshes.push({
        id: "seed",
        view: "slide",
        soup: seedSoup,
        edgeColor: withAlpha(WHITE, progress(t, 0, 800)),
        edgeWidth: 1.5,
        opacity: 1,
      });
      frame.hud.caption = "Two triangles, corner to corner";
      return frame;
    },
  };

  return [imageStep, seedStep];
}
