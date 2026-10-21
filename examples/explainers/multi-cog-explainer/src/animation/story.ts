import type { BandId } from "../scene/constants.js";
import {
  BAND_IDS,
  BANDS,
  INSET_UV,
  SCENE_ORIGIN,
  STORY_TILE,
} from "../scene/constants.js";
import type { Rect } from "../scene/layout.js";
import { INTRO_SLOTS, SCENE_BOX } from "../scene/layout.js";
import type { SceneData } from "../scene/load.js";
import { flyRect } from "./flight.js";
import type { Frame, Label, Rgba } from "./frame.js";
import { emptyFrame } from "./frame.js";
import { progress } from "./math.js";

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

const MUTED = "#8b949e";
const WHITE: Rgba = [230, 237, 243, 255];

const REPROJECTION_EXPLAINER_URL =
  "https://developmentseed.org/deck.gl-raster/examples/reprojection-explainer/";

/** A band's colour as CSS. */
function css([r, g, b, a]: Rgba): string {
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

/** A label, centred on its anchor unless `align` says otherwise. */
function label(
  id: string,
  text: string,
  x: number,
  y: number,
  options: {
    color?: string;
    opacity?: number;
    align?: Label["align"];
    size?: number;
  } = {},
): Label {
  return {
    id,
    text,
    x,
    y,
    align: options.align ?? "center",
    color: options.color ?? "#e6edf3",
    opacity: options.opacity ?? 1,
    size: options.size,
  };
}

/** The four corners of a rect, as a ring. */
export function rectRing(rect: Rect): [number, number][] {
  const { x, y, width, height } = rect;
  return [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];
}

/** "B04 · Red · 10 m": a band's name, as the labels show it. */
function bandName(band: BandId): string {
  const spec = BANDS[band];
  return `${spec.file} · ${spec.label} · ${spec.pixelSize} m`;
}

/** Kilometres, as the descriptions write them. */
function km(meters: number): string {
  return `${Number((meters / 1000).toFixed(2))} km`;
}

/** The inset of step 1: a box in the bottom-right corner of a slot. */
function insetBox(slot: Rect): Rect {
  const size = 180;
  return {
    x: slot.x + slot.width - size - 12,
    y: slot.y + slot.height - size - 12,
    width: size,
    height: size,
  };
}

/** The story: nine steps that follow one Sentinel-2 tile through the layer. */
export function createStory(scene: SceneData): StoryStep[] {
  const { tile } = scene;
  const { primaryCorners } = tile;
  // Where step 1's insets look, in UTM metres.
  const insetPoint: [number, number] = [
    primaryCorners.topLeft[0] +
      INSET_UV[0] * (primaryCorners.bottomRight[0] - primaryCorners.topLeft[0]),
    primaryCorners.topLeft[1] +
      INSET_UV[1] * (primaryCorners.bottomRight[1] - primaryCorners.topLeft[1]),
  ];
  const tileMeters = (band: BandId) =>
    BANDS[band].block * BANDS[band].pixelSize;
  const primaryGrid = Math.ceil(BANDS.b04.size / BANDS.b04.block);
  const b01Count = tile.bands.b01.tiles.length;

  /** Step 1: the three bands, side by side, with the same spot magnified. */
  const threeFiles: StoryStep = {
    id: "three-files",
    title: "Three files, one scene",
    description: [
      "Sentinel-2 stores each band as its own Cloud-Optimized GeoTIFF, at its own resolution. Here are three bands of one scene over Torres del Paine, Chile: ",
      { text: bandName("b04"), emphasis: true },
      `, ${BANDS.b04.size} x ${BANDS.b04.size} pixels; `,
      { text: bandName("b11"), emphasis: true },
      `, ${BANDS.b11.size} x ${BANDS.b11.size}; and `,
      { text: bandName("b01"), emphasis: true },
      `, ${BANDS.b01.size} x ${BANDS.b01.size}. The insets show the same 600 m square in each.`,
    ],
    durationMs: 1600,
    frame: (t) => {
      const frame = emptyFrame();
      const fadeIn = progress(t, 0, 600);
      const insetIn = progress(t, 800, 600);
      BAND_IDS.forEach((band, i) => {
        const slot = INTRO_SLOTS[i]!;
        const color = css(BANDS[band].color);
        frame.bitmaps.push({
          id: `${band}-overview`,
          image: `${band}-overview`,
          rect: slot,
          opacity: fadeIn,
        });
        const inset = insetBox(slot);
        frame.bitmaps.push({
          id: `${band}-inset`,
          image: `${band}-inset`,
          rect: inset,
          opacity: insetIn,
          nearest: true,
        });
        // Where the inset looks: a small square on the overview.
        const scale = slot.width / (BANDS[band].size * BANDS[band].pixelSize);
        const markerX = slot.x + (insetPoint[0] - SCENE_ORIGIN[0]) * scale;
        const markerY = slot.y + (SCENE_ORIGIN[1] - insetPoint[1]) * scale;
        frame.polygons.push({
          id: `${band}-inset-outline`,
          rings: [
            rectRing(inset),
            rectRing({ x: markerX - 6, y: markerY - 6, width: 12, height: 12 }),
          ],
          line: [...WHITE.slice(0, 3), Math.round(255 * insetIn)] as Rgba,
          lineWidth: 2,
        });
        frame.hud.labels.push(
          label(
            `${band}-name`,
            bandName(band),
            slot.x + slot.width / 2,
            slot.y + slot.height + 32,
            {
              color,
              opacity: fadeIn,
              size: 26,
            },
          ),
          label(
            `${band}-size`,
            `${BANDS[band].size} x ${BANDS[band].size} pixels`,
            slot.x + slot.width / 2,
            slot.y + slot.height + 66,
            { color: MUTED, opacity: fadeIn },
          ),
        );
      });
      frame.hud.caption = "Three bands of one scene, at 10 m, 20 m and 60 m";
      return frame;
    },
  };

  /** Step 2: the three images merge into the composite. */
  const oneImage: StoryStep = {
    id: "one-image",
    title: "One image",
    description: [
      "MultiCOGLayer draws the three as one picture: shortwave infrared as red, red as green, and coastal aerosol as blue. Every pixel mixes values from files at three different resolutions. How do they line up? ",
      {
        text: "(This whole-scene picture is drawn by the same shader, from each band's smallest overview.)",
        emphasis: true,
      },
    ],
    durationMs: 1600,
    frame: (t) => {
      const frame = emptyFrame();
      const p = progress(t, 0, 1600);
      BAND_IDS.forEach((band, i) => {
        const opacity = 1 - p;
        if (opacity > 0) {
          frame.bitmaps.push({
            id: `${band}-overview`,
            image: `${band}-overview`,
            rect: flyRect(INTRO_SLOTS[i]!, SCENE_BOX, p),
            opacity,
          });
        }
      });
      frame.composites.push({
        id: "scene",
        source: "overview",
        rect: p < 1 ? flyRect(INTRO_SLOTS[1]!, SCENE_BOX, p) : SCENE_BOX,
        opacity: p,
      });
      frame.hud.caption = "One image, from three resolutions";
      return frame;
    },
  };

  const steps: StoryStep[] = [
    threeFiles,
    oneImage,
    {
      id: "primary-grid",
      title: "The primary grid",
      description: [
        `The finest band is the primary: its tile grid decides what gets drawn. At full resolution it has ${primaryGrid} x ${primaryGrid} tiles of ${BANDS.b04.block} x ${BANDS.b04.block} pixels, each ${km(tileMeters("b04"))} across. We'll follow one tile, (${STORY_TILE.x}, ${STORY_TILE.y}).`,
      ],
      durationMs: 0,
      frame: () => emptyFrame(),
    },
    {
      id: "band-grids",
      title: "Every band has its own tiles",
      description: [
        `The other bands have their own grids. A 20 m tile is ${BANDS.b11.block} pixels too, so it covers ${km(tileMeters("b11"))}: one 20 m tile covers the whole primary tile. The 60 m band uses ${BANDS.b01.block}-pixel tiles, ${km(tileMeters("b01"))} across, which don't line up with the 10 m grid, so the primary tile needs ${b01Count} of them.`,
      ],
      durationMs: 0,
      frame: () => emptyFrame(),
    },
    {
      id: "fetch",
      title: "Fetch",
      description: [
        `For each band, the layer fetches the tiles that cover the primary tile: one 10 m tile, one 20 m tile and ${b01Count} 60 m tiles. Each is ${BANDS.b04.block} or ${BANDS.b01.block} pixels on a side, but they cover very different ground.`,
      ],
      durationMs: 0,
      frame: () => emptyFrame(),
    },
    {
      id: "stitch",
      title: "Stitch",
      description: [
        `The ${b01Count} 60 m tiles are stitched into one ${tile.bands.b01.stitchedWidth} x ${tile.bands.b01.stitchedHeight} texture, so every band has exactly one texture to sample.`,
      ],
      durationMs: 0,
      frame: () => emptyFrame(),
    },
    {
      id: "uv",
      title: "Where the tile lands",
      description: [
        "Each band gets a UV transform: where the primary tile sits inside that band's texture, as an offset and a scale.",
      ],
      durationMs: 0,
      frame: () => emptyFrame(),
    },
    {
      id: "sample",
      title: "Sample",
      description: [
        "For every pixel of the tile, the shader applies each band's UV transform and samples that band's texture there. The three values become red, green and blue.",
      ],
      durationMs: 0,
      frame: () => emptyFrame(),
    },
    {
      id: "on-the-map",
      title: "The tile on the map",
      description: [
        "That shader output is the tile, drawn in its place. Every tile on screen is composited the same way. To see how each tile is then reprojected onto the map, see the ",
        { text: "reprojection explainer", href: REPROJECTION_EXPLAINER_URL },
        ".",
      ],
      durationMs: 0,
      frame: () => emptyFrame(),
    },
  ];
  return steps;
}
