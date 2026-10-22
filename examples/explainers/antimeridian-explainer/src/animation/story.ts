import type { Mesh2D } from "@developmentseed/deck.gl-raster/internal/clip-mesh-to-world.js";
import type { TriangleSoup } from "../layers/triangle-soup.js";
import { MAX_ERROR, PERIOD } from "../scene/constants.js";
import type { LandPolygon } from "../scene/land.js";
import { landInRange } from "../scene/land.js";
import type { Camera } from "../scene/layout.js";
import {
  CLOSEUP_BOX,
  cameraForBounds,
  commonToSlide,
  IMAGE_BOX,
  lerpCamera,
  MAP_BOX,
  STRIP_BOX,
  uvToSlide,
} from "../scene/layout.js";
import type { SourceImage } from "../scene/load.js";
import type { MeshScene } from "../scene/mesh.js";
import { CORNER_IDS } from "../scene/mesh.js";
import type {
  Frame,
  Label,
  LineDraw,
  PolygonDraw,
  Rgba,
  ViewId,
} from "./frame.js";
import { emptyFrame } from "./frame.js";
import { easeInOutCubic, lerp, progress } from "./math.js";
import type { ScheduleOptions } from "./refine-schedule.js";
import { scheduleRefinement } from "./refine-schedule.js";
import type { UnitColor } from "./soup.js";
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
  /**
   * Times into the step, in ms, where it holds until the presenter presses
   * next: its beats. Without stops, the step plays through.
   */
  stops?: number[];
  /** What to draw `timeMs` into the step. */
  frame(timeMs: number): Frame;
};

// GitHub's dark palette, like the slide.
const MUTED = "#8b949e";
const WHITE: Rgba = [230, 237, 243, 255];
/** Graticule lines. */
const GRID: Rgba = [139, 148, 158, 70];
/** proj4's raw answers, a world away. */
const RAW: Rgba = [240, 100, 85, 255];
/** Points moved to the copy of the world they belong in. */
const SNAPPED: Rgba = [90, 220, 130, 255];
/** The 180° meridian. */
const MERIDIAN: Rgba = [255, 166, 87, 255];
/** Land under the map views, a shade lighter than the slide. */
const LAND_FILL: Rgba = [33, 40, 49, 255];
/** Coastlines under the map views. */
const LAND_LINE: Rgba = [62, 70, 81, 255];
/** Coastlines up close, over everything. */
const COAST: Rgba = [230, 237, 243, 190];

/** How long a corner takes to fly from the image to the map, in ms. */
const FLIGHT_MS = 900;

/** How long the time-lapse holds each snapshot of the refinement, in ms. */
const SNAPSHOT_MS = 550;

/** A point partway from `from` to `to`, eased. */
function flyPoint(
  from: [number, number],
  to: [number, number],
  t: number,
): [number, number] {
  const e = easeInOutCubic(t);
  return [lerp(from[0], to[0], e), lerp(from[1], to[1], e)];
}

/** How long the map takes to split into the strip and the close-up, in ms. */
const SPLIT_MS = 700;

/** How long the close-up takes to fade in after the split, in ms. */
const FADE_MS = 400;

/** How long each walk sample's beat takes: the image, the strip, up close. */
const SAMPLE_MS = 1500;

/** How long a walk sample's leader takes to fade once the next one starts, in ms. */
const LEADER_FADE_MS = 300;

/** A point `distance` from `at`, square to the line from `from` to `at`. */
function beside(
  from: [number, number],
  at: [number, number],
  distance: number,
): [number, number] {
  const length = Math.hypot(at[0] - from[0], at[1] - from[1]) || 1;
  return [
    at[0] - ((at[1] - from[1]) / length) * distance,
    at[1] + ((at[0] - from[0]) / length) * distance,
  ];
}

/** The refinement replay's pacing: quicker than the reprojection explainer's. */
const REFINE_SCHEDULE: ScheduleOptions = {
  slowSteps: 2,
  highlightMs: 350,
  cutMs: 150,
  snapMs: 300,
  holdMs: 150,
  speedup: 0.8,
  minStepMs: 80,
};

/** An error in output pixels, as the counter writes it. */
function errorText(error: number): string {
  return `${error < 10 ? error.toFixed(2) : count(Math.round(error))} px`;
}

/** When step 8 cuts the crossing triangles, in ms. */
const CUT_MS = 900;

/** When step 8 starts moving the overhang one world over, in ms. */
const SWAP_MS = 1500;

/** How long the overhang takes to move one world over, in ms. */
const MOVE_MS = 1600;

/** The reprojection explainer, for how refinement chooses its splits. */
const REPROJECTION_EXPLAINER_URL =
  "https://developmentseed.org/deck.gl-raster/examples/reprojection-explainer/";

/** The x of a triangle's centroid. */
function centroidX(mesh: Mesh2D, t: number): number {
  let sum = 0;
  for (let k = 0; k < 3; k++) {
    sum += mesh.positions[2 * mesh.triangles[3 * t + k]!]!;
  }
  return sum / 3;
}

/** The mesh with only the triangles `keep` accepts. */
function subMesh(mesh: Mesh2D, keep: (t: number) => boolean): Mesh2D {
  const triangles: number[] = [];
  for (let t = 0; t < mesh.triangles.length / 3; t++) {
    if (keep(t)) {
      triangles.push(...mesh.triangles.slice(3 * t, 3 * t + 3));
    }
  }
  return { ...mesh, triangles };
}

/**
 * The cut, in texture coordinates: the edges of the cut mesh that lie on the
 * world's edge (x 0 or 512) at both ends.
 */
function cutSegments(mesh: Mesh2D): [[number, number], [number, number]][] {
  const onCut = (v: number) => {
    const x = mesh.positions[2 * v]!;
    return Math.abs(x) < 1e-6 || Math.abs(x - PERIOD) < 1e-6;
  };
  const uv = (v: number): [number, number] => [
    mesh.uvs[2 * v]!,
    mesh.uvs[2 * v + 1]!,
  ];
  const segments: [[number, number], [number, number]][] = [];
  for (let t = 0; t < mesh.triangles.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const a = mesh.triangles[3 * t + k]!;
      const b = mesh.triangles[3 * t + ((k + 1) % 3)]!;
      if (onCut(a) && onCut(b)) {
        segments.push([uv(a), uv(b)]);
      }
    }
  }
  return segments;
}

/** How long the probe takes to sweep the image one way, in ms. */
const SWEEP_MS = 3200;

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

/** One decimal, as the labels write coordinates. */
function short(value: number): string {
  return value.toFixed(1);
}

/** A count with thousands separators, as the HUD writes it. */
function count(n: number): string {
  return n.toLocaleString("en-US");
}

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

/** Land under a map view, faded by `opacity`; nothing when there is none. */
function landUnder(
  view: ViewId,
  polygons: [number, number][][][],
  opacity: number,
): PolygonDraw[] {
  if (polygons.length === 0) {
    return [];
  }
  return [
    {
      id: "land",
      view,
      polygons,
      fill: withAlpha(LAND_FILL, opacity),
      line: withAlpha(LAND_LINE, opacity),
      under: true,
    },
  ];
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
  tintOf?: (triangle: number) => UnitColor | null;
}): TriangleSoup {
  const positions: number[] = [];
  for (let i = 0; i < mesh.uvs.length; i += 2) {
    positions.push(...uvToSlide([mesh.uvs[i]!, mesh.uvs[i + 1]!]));
  }
  return createSoup({
    triangles: mesh.triangles,
    positions,
    uvs: mesh.uvs,
    tintOf: mesh.tintOf,
  });
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

/**
 * The story: nine steps that follow one image's mesh across 180°, with `land`
 * under the map views (none by default).
 */
export function createStory(
  scene: MeshScene,
  _image: SourceImage,
  land: LandPolygon[] = [],
): StoryStep[] {
  const centerY = scene.center.position[1];
  const worldWidth = PERIOD + 2 * WORLD_MARGIN;
  /** The whole world, in the whole map box (steps 1-4). */
  const worldCamera: Camera = {
    rect: MAP_BOX,
    center: [PERIOD / 2, centerY],
    scale: MAP_BOX.width / worldWidth,
  };
  /** The land the whole-world views show, past both edges included. */
  const worldLand = landInRange(land, [-WORLD_MARGIN, PERIOD + WORLD_MARGIN]);
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
    frame.polygons.push(...landUnder("world", worldLand, opacity));
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
      "An image in UTM zone 60N, 42 x 42 pixels of 20 km, over the Aleutian Islands. The 180° meridian crosses it at a slant. On a Web Mercator map, 180° is both edges of the world, so the image belongs at both: its west part at the map's east edge, its east part at the west edge.",
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

  /** Each snapshot's triangles, built once: the last has 20,001. */
  const plainSoups = new Map(
    scene.plain.map((snapshot) => [snapshot, mapSoup(snapshot)]),
  );

  /** The plain projection's mesh in the whole-world view. */
  const plainMesh = (
    snapshot: Snapshot,
    options: { edges: number; opacity: number },
  ) => ({
    id: "plain",
    view: "world" as const,
    soup: plainSoups.get(snapshot) ?? mapSoup(snapshot),
    edgeColor: withAlpha(WHITE, options.edges),
    edgeWidth: 1,
    opacity: options.opacity,
  });

  /** The triangle count and error of a mesh, under the map. */
  const counter = (snapshot: Snapshot, opacity: number): Label =>
    label(
      "counter",
      `${count(snapshot.triangles.length / 3)} triangles · ${count(Math.round(snapshot.maxError))} px off`,
      [MAP_BOX.x + MAP_BOX.width / 2, MAP_BOX.y + MAP_BOX.height - 24],
      { color: css(WHITE), opacity, size: 24 },
    );

  /** Step 3: proj4 puts each corner in one world, so the triangles span it. */
  const seedPlain = scene.plain[0]!;
  const cornersStep: StoryStep = {
    id: "corners",
    title: "Project the corners",
    description: [
      `The reprojector places each corner exactly, with proj4. But proj4 returns every point in one copy of the world, from -180° to 180°, which is x 0 to ${PERIOD} on the map. The image's west corners land at x ${Math.round(scene.corners.nw.raw[0])} and ${Math.round(scene.corners.sw.raw[0])}, at the map's east edge, and its east corners at x ${Math.round(scene.corners.ne.raw[0])} and ${Math.round(scene.corners.se.raw[0])}, at the west edge, so both triangles stretch across the whole world.`,
    ],
    durationMs: 2600,
    stops: [FLIGHT_MS + 500],
    frame: (t) => {
      const frame = emptyFrame();
      pushImage(frame, 1);
      pushWorld(frame, 1);
      frame.meshes.push({
        id: "seed",
        view: "slide",
        soup: seedSoup,
        edgeColor: WHITE,
        edgeWidth: 1.5,
        opacity: 1,
      });
      const landed = progress(t, 0, FLIGHT_MS + 3 * 150) >= 1;
      if (landed) {
        frame.dots.push({
          id: "corners",
          view: "world",
          points: CORNER_IDS.map((id) => scene.corners[id].raw),
          color: RAW,
          radius: 6,
        });
      } else {
        frame.dots.push({
          id: "corners-flying",
          view: "slide",
          points: CORNER_IDS.map((id, i) =>
            flyPoint(
              uvToSlide(scene.corners[id].uv),
              commonToSlide(worldCamera, scene.corners[id].raw),
              progress(t, 150 * i, FLIGHT_MS),
            ),
          ),
          color: RAW,
          radius: 6,
        });
      }
      const stretch = progress(t, FLIGHT_MS + 600, 700);
      if (stretch > 0) {
        frame.meshes.push(
          plainMesh(seedPlain, { edges: stretch, opacity: stretch }),
        );
      }
      frame.hud.caption = "proj4 puts each corner in one world";
      return frame;
    },
  };

  /** Step 4: a time-lapse of refining the plain projection. */
  const plain = scene.plain;
  const plainStep: StoryStep = {
    id: "plain",
    title: "Refining can't fix it",
    description: [
      `Refining adds triangles where the mesh is furthest off. Here it never gets close: after ${count(plain[plain.length - 1]!.triangles.length / 3)} triangles it gives up, still ${count(Math.round(plain[plain.length - 1]!.maxError))} output pixels off. The triangles along 180° still span the world, because the jump is in the projection, not in the mesh.`,
    ],
    durationMs: plain.length * SNAPSHOT_MS + 600,
    frame: (t) => {
      const frame = emptyFrame();
      pushImage(frame, 1);
      pushWorld(frame, 1);
      const index = Math.min(plain.length - 1, Math.floor(t / SNAPSHOT_MS));
      const snapshot = plain[index]!;
      const triangles = snapshot.triangles.length / 3;
      // Fade the edges as the mesh gets denser, so it stays legible.
      const edges = Math.max(0.12, Math.min(0.8, 8 / Math.sqrt(triangles)));
      frame.meshes.push(plainMesh(snapshot, { edges, opacity: 1 }));
      frame.hud.labels.push(counter(snapshot, 1));
      frame.hud.caption = "More triangles, the same jump";
      return frame;
    },
  };

  /** The whole world, squeezed into the strip (from step 5). */
  const stripCamera: Camera = {
    rect: STRIP_BOX,
    center: [PERIOD / 2, centerY],
    scale: STRIP_BOX.width / worldWidth,
  };
  const meshBounds = boundsOf(scene.mesh.positions);
  /** The seam up close: the unwrapped mesh, with room past the world's edge. */
  const closeupCamera = cameraForBounds(
    CLOSEUP_BOX,
    [
      meshBounds[0] - 3,
      meshBounds[1] - 1,
      meshBounds[2] + 3,
      meshBounds[3] + 1,
    ],
    24,
  );
  const closeupHalfWidth = closeupCamera.rect.width / 2 / closeupCamera.scale;
  /** The land the close-up shows: the Aleutians, either side of the seam. */
  const closeupLand = landInRange(land, [
    closeupCamera.center[0] - closeupHalfWidth,
    closeupCamera.center[0] + closeupHalfWidth,
  ]);

  /**
   * The world morphing into the strip as `split` runs 0-1, then the close-up
   * of the seam, fading in with `opacity` (steps 5-9).
   */
  const pushSplit = (
    frame: Frame,
    options: { split: number; opacity: number },
  ): { strip: Camera; closeup: Camera | null } => {
    const strip = lerpCamera(
      worldCamera,
      stripCamera,
      easeInOutCubic(options.split),
    );
    frame.cameras.strip = strip;
    frame.polygons.push(...landUnder("strip", worldLand, 1));
    frame.lines.push(graticule("strip", 1), worldEdges("strip", strip, 1));
    frame.hud.labels.push(...worldEdgeLabels(strip, 1));
    if (options.split < 1) {
      return { strip, closeup: null };
    }
    const closeup = closeupCamera;
    frame.cameras.closeup = closeup;
    frame.polygons.push(...landUnder("closeup", closeupLand, options.opacity));
    if (closeupLand.length > 0) {
      // Up close, coastlines go over everything, so the islands show through
      // the image.
      frame.polygons.push({
        id: "coast",
        view: "closeup",
        polygons: closeupLand,
        line: withAlpha(COAST, options.opacity),
      });
    }
    frame.lines.push(worldEdges("closeup", closeup, options.opacity));
    const [seamX] = commonToSlide(closeup, [0, 0]);
    // The seam is both edges of the world: 180° for the copy to its west, and
    // -180° for this one. Each name goes on its own side of the line.
    frame.hud.labels.push(
      label("seam-west", "180°", [seamX - 8, CLOSEUP_BOX.y + 16], {
        align: "right",
        color: css(MERIDIAN),
        opacity: options.opacity,
        size: 18,
      }),
      label("seam-east", "-180°", [seamX + 8, CLOSEUP_BOX.y + 16], {
        align: "left",
        color: css(MERIDIAN),
        opacity: options.opacity,
        size: 18,
      }),
      label(
        "past-edge",
        "past the world's west edge",
        [(CLOSEUP_BOX.x + seamX) / 2, CLOSEUP_BOX.y + CLOSEUP_BOX.height - 18],
        { opacity: options.opacity, size: 18 },
      ),
      label(
        "map-title",
        "The map · the whole world (top) and the seam up close",
        [MAP_BOX.x + MAP_BOX.width / 2, MAP_BOX.y + MAP_BOX.height + 34],
        { opacity: options.opacity, size: 22 },
      ),
    );
    return { strip, closeup };
  };

  /** Step 5: walk from the center to each corner, one sample per beat. */
  const walkSamples = CORNER_IDS.flatMap((id) =>
    scene.walks[id].samples.map((sample, k) => ({
      sample,
      from: k === 0 ? scene.center.uv : scene.walks[id].samples[k - 1]!.uv,
    })),
  );
  // The first sample starts once the close-up has faded in, so the step's
  // first stop holds on a finished frame.
  const sampleStart = (k: number) => SPLIT_MS + FADE_MS + k * SAMPLE_MS;
  const walkStep: StoryStep = {
    id: "walk",
    title: "Walk to the corners",
    description: [
      `Before meshing, the layer unwraps the corners. It starts at the image's center, which proj4 puts at x ${short(scene.center.position[0])}, and walks toward each corner. Each sample proj4 returns (red, in the world above) moves to the copy of the world nearest the sample before it (green, up close). The west corners come out at x ${short(scene.corners.nw.unwrapped[0])} and ${short(scene.corners.sw.unwrapped[0])}, past the world's west edge, instead of ${Math.round(scene.corners.nw.raw[0])} and ${Math.round(scene.corners.sw.raw[0])}.`,
    ],
    durationMs: sampleStart(walkSamples.length) + 400,
    stops: walkSamples.map((_, k) => sampleStart(k)),
    frame: (t) => {
      const frame = emptyFrame();
      pushImage(frame, 1);
      const { strip, closeup } = pushSplit(frame, {
        split: progress(t, 0, SPLIT_MS),
        opacity: progress(t, SPLIT_MS, FADE_MS),
      });
      frame.hud.caption = "Each step moves to the copy nearest the step before";
      if (!closeup) {
        return frame;
      }
      const centerSlide = uvToSlide(scene.center.uv);
      const centerCloseup = commonToSlide(closeup, scene.center.position);
      // Right of the center: between the walks, clear of the meridian.
      frame.hud.labels.push(
        label(
          "walk-center-image",
          "center",
          [centerSlide[0] + 10, centerSlide[1]],
          { align: "left", color: css(WHITE), size: 15 },
        ),
        label(
          "walk-center-closeup",
          "center",
          [centerCloseup[0] + 10, centerCloseup[1]],
          { align: "left", color: css(WHITE), size: 15 },
        ),
      );
      const paths: [number, number][][] = [];
      const imagePoints: [number, number][] = [];
      const rawPoints: [number, number][] = [];
      const movedPoints: [number, number][] = [];
      const flyingRaw: [number, number][] = [];
      const flyingMoved: [number, number][] = [];
      /** The samples in the strip, and at which edge of the world. */
      const rawLanded: {
        number: string;
        at: [number, number];
        east: boolean;
      }[] = [];
      walkSamples.forEach(({ sample, from }, k) => {
        const local = t - sampleStart(k);
        if (local <= 0) {
          return;
        }
        // First the image: the walk reaches the sample.
        const reach = progress(local, 0, 200);
        const fromSlide = uvToSlide(from);
        const atSlide = uvToSlide(sample.uv);
        paths.push([
          fromSlide,
          [
            lerp(fromSlide[0], atSlide[0], reach),
            lerp(fromSlide[1], atSlide[1], reach),
          ],
        ]);
        if (reach < 1) {
          return;
        }
        imagePoints.push(atSlide);
        // Each sample is numbered in all three places, in walk order.
        const number = String(k + 1);
        frame.hud.labels.push(
          label(
            `walk-image-${number}`,
            number,
            beside(centerSlide, atSlide, 16),
            {
              color: css(WHITE),
              size: 16,
            },
          ),
        );
        // Then the strip: where proj4 puts it.
        const raw: [number, number] = [sample.raw, sample.y];
        const moved: [number, number] = [sample.x, sample.y];
        const rawSlide = commonToSlide(strip, raw);
        const toStrip = progress(local, 350, 500);
        if (toStrip > 0 && toStrip < 1) {
          flyingRaw.push(flyPoint(atSlide, rawSlide, toStrip));
        }
        if (toStrip < 1) {
          return;
        }
        rawPoints.push(raw);
        rawLanded.push({ number, at: rawSlide, east: raw[0] > PERIOD / 2 });
        // Then up close: the copy nearest the step before.
        const movedSlide = commonToSlide(closeup, moved);
        const toCloseup = progress(local, 1000, 400);
        if (toCloseup < 1) {
          flyingMoved.push(flyPoint(rawSlide, movedSlide, toCloseup));
          return;
        }
        movedPoints.push(moved);
        frame.hud.labels.push(
          label(
            `walk-moved-${number}`,
            number,
            beside(centerCloseup, movedSlide, 18),
            { color: css(SNAPPED), size: 16 },
          ),
        );
        // Only the latest sample keeps its leader; the numbers link the rest.
        const fade =
          k < walkSamples.length - 1
            ? progress(t, sampleStart(k + 1), LEADER_FADE_MS)
            : 0;
        if (fade < 1) {
          // Dashed: a move to another copy of the world, not a path.
          frame.lines.push({
            id: `leader-${number}`,
            view: "slide",
            paths: [[rawSlide, movedSlide]],
            color: withAlpha(WHITE, 0.35 * (1 - fade)),
            width: 1,
            dashed: true,
          });
        }
      });
      // The strip's dots crowd at the world's two edges, so each edge gets one
      // label listing its samples, beside them on the map's side.
      for (const east of [true, false]) {
        const group = rawLanded.filter((landed) => landed.east === east);
        if (group.length === 0) {
          continue;
        }
        const xs = group.map((landed) => landed.at[0]);
        const y =
          group.reduce((sum, landed) => sum + landed.at[1], 0) / group.length;
        frame.hud.labels.push(
          label(
            east ? "walk-raw-east-edge" : "walk-raw-west-edge",
            group.map((landed) => landed.number).join(", "),
            east ? [Math.min(...xs) - 10, y] : [Math.max(...xs) + 10, y],
            { align: east ? "right" : "left", color: css(RAW), size: 16 },
          ),
        );
      }
      frame.lines.push({
        id: "walk-paths",
        view: "slide",
        paths,
        color: WHITE,
        width: 2,
      });
      frame.dots.push(
        {
          id: "center",
          view: "slide",
          points: [centerSlide],
          color: WHITE,
          radius: 5,
        },
        {
          id: "center",
          view: "closeup",
          points: [scene.center.position],
          color: WHITE,
          radius: 5,
        },
        {
          id: "walk-image",
          view: "slide",
          points: imagePoints,
          color: WHITE,
          radius: 4,
        },
        {
          id: "walk-raw",
          view: "strip",
          points: rawPoints,
          color: RAW,
          radius: 4,
        },
        {
          id: "walk-moved",
          view: "closeup",
          points: movedPoints,
          color: SNAPPED,
          radius: 6,
        },
        {
          id: "flying-raw",
          view: "slide",
          points: flyingRaw,
          color: RAW,
          radius: 5,
        },
        {
          id: "flying-moved",
          view: "slide",
          points: flyingMoved,
          color: SNAPPED,
          radius: 6,
        },
      );
      return frame;
    },
  };

  /** The four unwrapped corners, and the quad through them, up close. */
  const pushUnwrappedCorners = (frame: Frame, opacity: number) => {
    const points = CORNER_IDS.map((id) => scene.corners[id].unwrapped);
    const [nw, ne, sw, se] = points;
    frame.lines.push({
      id: "corner-quad",
      view: "closeup",
      paths: [[nw!, ne!, se!, sw!, nw!]],
      color: withAlpha(SNAPPED, 0.5 * opacity),
      width: 1.5,
      dashed: true,
    });
    frame.dots.push({
      id: "corners-unwrapped",
      view: "closeup",
      points,
      color: withAlpha(SNAPPED, opacity),
      radius: 5,
    });
  };

  /** Step 6: a probe sweeps the image; its raw x jumps, its snapped x doesn't. */
  const probe = scene.probe;
  const probeIndex = (t: number) =>
    Math.round(Math.min(1, t / SWEEP_MS) * (probe.length - 1));
  const probeTime = (index: number) => (index / (probe.length - 1)) * SWEEP_MS;
  // The first sample east of 180°, where proj4's answer is already right.
  const firstEast = probe.findIndex(
    (sample) => Math.abs(sample.raw[0] - sample.snapped[0]) < 1,
  );
  const probeStep: StoryStep = {
    id: "snap",
    title: "Snap every point",
    description: [
      `To find where the mesh is furthest off, the reprojector projects four check points in each triangle: its center and the middle of each edge. For this image, it projects ${count(scene.refinement.projections)} times in all. So the layer wraps the projection itself: each x proj4 returns moves to the copy of the world nearest the blend of the four unwrapped corners at that pixel. The probe here is the explainer's, not the reprojector's: as it sweeps the middle row across 180°, proj4's answer (red) jumps a whole world, but the snapped point (green) moves smoothly. This holds unless the image contains a pole.`,
    ],
    durationMs: SWEEP_MS + 600,
    stops: [probeTime(firstEast - 1), probeTime(firstEast)],
    frame: (t) => {
      const frame = emptyFrame();
      pushImage(frame, 1);
      const { strip, closeup } = pushSplit(frame, { split: 1, opacity: 1 });
      pushUnwrappedCorners(frame, 1);
      const index = probeIndex(t);
      const sample = probe[index]!;
      const trail = probe.slice(0, index + 1);
      frame.lines.push(
        {
          id: "probe-trail",
          view: "closeup",
          paths: [trail.map((s) => s.snapped)],
          color: withAlpha(SNAPPED, 0.7),
          width: 2,
        },
        {
          id: "probe-leader",
          view: "slide",
          paths: [
            [
              commonToSlide(strip, sample.raw),
              commonToSlide(closeup!, sample.snapped),
            ],
          ],
          color: withAlpha(WHITE, 0.45),
          width: 1,
          dashed: true,
        },
      );
      frame.dots.push(
        {
          id: "probe-trail-raw",
          view: "strip",
          points: trail.map((s) => s.raw),
          color: withAlpha(RAW, 0.5),
          radius: 2,
        },
        {
          id: "probe-image",
          view: "slide",
          points: [uvToSlide(sample.uv)],
          color: WHITE,
          radius: 7,
        },
        {
          id: "probe-raw",
          view: "strip",
          points: [sample.raw],
          color: RAW,
          radius: 6,
        },
        {
          id: "probe-snapped",
          view: "closeup",
          points: [sample.snapped],
          color: SNAPPED,
          radius: 7,
        },
      );
      const [rawX, rawY] = commonToSlide(strip, sample.raw);
      const [snappedX, snappedY] = commonToSlide(closeup!, sample.snapped);
      const [probeX, probeY] = uvToSlide(sample.uv);
      frame.hud.labels.push(
        label("probe-name", "probe", [probeX, probeY - 22], {
          color: css(WHITE),
          size: 16,
        }),
        label(
          "probe-raw",
          `proj4: x ${short(sample.raw[0])}`,
          [rawX, rawY + 22],
          {
            color: css(RAW),
            size: 18,
          },
        ),
        label(
          "probe-snapped",
          `snapped: x ${short(sample.snapped[0])}`,
          [snappedX, snappedY + 26],
          { color: css(SNAPPED), size: 18 },
        ),
      );
      frame.hud.caption =
        "Every point moves to the copy nearest the corners' blend";
      return frame;
    },
  };

  /** Step 7: the reprojector meshes the snapped projection, split by split. */
  const record = scene.refinement;
  const timings = scheduleRefinement(record.steps.length, REFINE_SCHEDULE);
  const lastEnd = timings[timings.length - 1]?.end ?? 0;
  /** The mesh after `done` splits, and its largest error. */
  const meshAfter = (done: number) => ({
    triangles:
      done === 0 ? record.seedTriangles : record.steps[done - 1]!.triangles,
    positions: record.positions,
    uvs: record.uvs,
    maxError:
      done === 0 ? record.seedMaxError : record.steps[done - 1]!.maxError,
  });
  const meshStep: StoryStep = {
    id: "mesh",
    title: "Mesh as usual",
    description: [
      `With every point snapped, the projection is continuous. The reprojector, which knows nothing about copies of the world, meshes it like any other image: it splits the triangle that is furthest off, until every triangle is within ${MAX_ERROR} output pixels. It needs ${count(scene.mesh.triangles.length / 3)} triangles. It measures the error on the map, as every layer now does; here it must, because the inverse projection is still wrapped.`,
    ],
    durationMs: lastEnd + 800,
    frame: (t) => {
      const frame = emptyFrame();
      pushImage(frame, 1);
      pushSplit(frame, { split: 1, opacity: 1 });
      const done = timings.filter((timing) => timing.end <= t).length;
      const mesh = meshAfter(done);
      frame.meshes.push(
        {
          id: "image-mesh",
          view: "slide",
          soup: imageSoup(mesh),
          edgeColor: withAlpha(WHITE, 0.8),
          edgeWidth: 1,
          opacity: 1,
        },
        {
          id: "mesh",
          view: "strip",
          soup: mapSoup(mesh),
          edgeColor: [0, 0, 0, 0],
          edgeWidth: 1,
          opacity: 1,
        },
        {
          id: "mesh",
          view: "closeup",
          soup: mapSoup(mesh),
          edgeColor: withAlpha(WHITE, 0.85),
          edgeWidth: 1,
          opacity: 1,
        },
      );
      // The split now playing: its new corner, where it lands.
      const playing = record.steps[done];
      if (playing && t >= timings[done]!.start) {
        const vertex = playing.vertex;
        frame.dots.push({
          id: "new-vertex",
          view: "closeup",
          points: [
            [record.positions[2 * vertex]!, record.positions[2 * vertex + 1]!],
          ],
          color: RAW,
          radius: 5,
        });
      }
      frame.hud.labels.push(
        label(
          "counter",
          `${count(mesh.triangles.length / 3)} triangles · ${errorText(mesh.maxError)} off`,
          [MAP_BOX.x + MAP_BOX.width / 2, MAP_BOX.y + MAP_BOX.height - 24],
          { color: css(WHITE), size: 24 },
        ),
      );
      frame.hud.caption = "Now the image meshes like any other";
      return frame;
    },
  };

  /** Step 8: cut the mesh at the world's edge, and move the overhang over. */
  const crossing = new Set(scene.crossing);
  const clipped = scene.clipped;
  const movedPart = subMesh(clipped, (t) => centroidX(clipped, t) > PERIOD / 2);
  const stayPart = subMesh(clipped, (t) => centroidX(clipped, t) <= PERIOD / 2);
  const cutPaths = cutSegments(clipped).map(([a, b]): [number, number][] => [
    uvToSlide(a),
    uvToSlide(b),
  ]);
  const crossingTint = (t: number): UnitColor | null =>
    crossing.has(t) ? [0.94, 0.39, 0.33, 0.55] : null;
  const cutStep: StoryStep = {
    id: "cut",
    title: "Cut at the world's edge",
    description: [
      `The mesh runs past the world's west edge, but the layer draws every tile inside one world, from -180° to 180°, and lets the map's copies of the world do the rest. So it cuts the ${scene.crossing.length} triangles that cross the edge along -180°, leaving ${count(clipped.triangles.length / 3)} triangles, and moves the part past the edge one world over, to the map's east edge. In the image, the cut runs along the 180° meridian.`,
    ],
    durationMs: SWAP_MS + MOVE_MS + 700,
    stops: [CUT_MS - 100, SWAP_MS],
    frame: (t) => {
      const frame = emptyFrame();
      pushImage(frame, 1);
      pushSplit(frame, { split: 1, opacity: 1 });
      if (t < CUT_MS) {
        frame.meshes.push(
          {
            id: "image-mesh",
            view: "slide",
            soup: imageSoup({ ...scene.mesh, tintOf: crossingTint }),
            edgeColor: withAlpha(WHITE, 0.8),
            edgeWidth: 1,
            opacity: 1,
          },
          {
            id: "mesh",
            view: "strip",
            soup: mapSoup(scene.mesh),
            edgeColor: [0, 0, 0, 0],
            edgeWidth: 1,
            opacity: 1,
          },
          {
            id: "mesh",
            view: "closeup",
            soup: createSoup({ ...scene.mesh, tintOf: crossingTint }),
            edgeColor: withAlpha(WHITE, 0.85),
            edgeWidth: 1,
            opacity: 1,
          },
        );
        frame.hud.caption = `${scene.crossing.length} triangles cross the world's edge`;
        return frame;
      }
      const move = easeInOutCubic(progress(t, SWAP_MS, MOVE_MS));
      frame.meshes.push(
        {
          id: "image-clipped",
          view: "slide",
          soup: imageSoup(clipped),
          edgeColor: withAlpha(WHITE, 0.8),
          edgeWidth: 1,
          opacity: 1,
        },
        {
          id: "clipped-stay",
          view: "closeup",
          soup: mapSoup(stayPart),
          edgeColor: withAlpha(WHITE, 0.85),
          edgeWidth: 1,
          opacity: 1,
        },
        {
          id: "clipped-leaving",
          view: "closeup",
          soup: mapSoup(movedPart, -PERIOD),
          edgeColor: withAlpha(WHITE, 0.85 * (1 - move)),
          edgeWidth: 1,
          opacity: 1 - move,
        },
      );
      if (move < 1) {
        frame.meshes.push(
          {
            id: "clipped-stay",
            view: "strip",
            soup: mapSoup(stayPart),
            edgeColor: [0, 0, 0, 0],
            edgeWidth: 1,
            opacity: 1,
          },
          {
            id: "clipped-moving",
            view: "strip",
            soup: mapSoup(movedPart, -PERIOD * (1 - move)),
            edgeColor: [0, 0, 0, 0],
            edgeWidth: 1,
            opacity: 1,
          },
        );
      } else {
        frame.meshes.push({
          id: "clipped",
          view: "strip",
          soup: mapSoup(clipped),
          edgeColor: [0, 0, 0, 0],
          edgeWidth: 1,
          opacity: 1,
        });
      }
      frame.lines.push({
        id: "cut",
        view: "slide",
        paths: cutPaths,
        color: RAW,
        width: 3,
      });
      frame.hud.caption = "Cut at -180°, and move the overhang one world over";
      return frame;
    },
  };

  /** Step 9: every copy of the world is drawn, so the parts meet at the seam. */
  const onMapStep: StoryStep = {
    id: "on-the-map",
    title: "On the map",
    description: [
      "The map draws a copy of every world side by side, so the part moved to the east edge also appears just west of the seam, in the next world over, beside the rest of the image. The two parts meet along 180°, and the image is continuous. To see how the reprojector chooses where to split, see the ",
      { text: "reprojection explainer", href: REPROJECTION_EXPLAINER_URL },
      ".",
    ],
    durationMs: 2400,
    frame: (t) => {
      const frame = emptyFrame();
      pushImage(frame, 1);
      pushSplit(frame, { split: 1, opacity: 1 });
      const edges = 0.8 * (1 - progress(t, 600, 1400));
      for (const [id, dx] of [
        ["clipped", 0],
        ["copy-west", -PERIOD],
        ["copy-east", PERIOD],
      ] as const) {
        for (const view of ["strip", "closeup"] as const) {
          if (view === "closeup" && id === "copy-east") {
            continue;
          }
          frame.meshes.push({
            id,
            view,
            soup: mapSoup(clipped, dx),
            edgeColor: withAlpha(WHITE, view === "closeup" ? edges : 0),
            edgeWidth: 1,
            opacity: 1,
          });
        }
      }
      frame.hud.caption =
        "Every world is drawn, so the two parts meet at the seam";
      return frame;
    },
  };

  return [
    imageStep,
    seedStep,
    cornersStep,
    plainStep,
    walkStep,
    probeStep,
    meshStep,
    cutStep,
    onMapStep,
  ];
}
