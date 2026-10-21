import type { BandId } from "../scene/constants.js";
import {
  BAND_IDS,
  BANDS,
  INSET_UV,
  SCENE_ORIGIN,
  STORY_TILE,
} from "../scene/constants.js";
import { levelFor } from "../scene/geometry.js";
import { gridRings, tileRing } from "../scene/grids.js";
import type { Rect } from "../scene/layout.js";
import {
  INTRO_SLOTS,
  SCENE_BOX,
  TEXTURE_SLOTS,
  utmToScene,
} from "../scene/layout.js";
import type { SceneData } from "../scene/load.js";
import { uvLabel, uvRect } from "../scene/uv.js";
import { flyRect } from "./flight.js";
import type { Frame, ImageId, Label, Rgba } from "./frame.js";
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

/** Gap between the 60 m tiles before they are stitched, in slide units. */
const PIECE_GAP = 12;

/** How long one tile takes to fly into the texture panel, in ms. */
const FLIGHT_MS = 1000;

/** Left edge of the legends beside the scene, in slide units. */
const LEGEND_X = 800;

/** Top line of the legends beside the scene, in slide units. */
const LEGEND_Y = 220;

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

/** A colour with its alpha scaled to `opacity` (0-1). */
function withAlpha([r, g, b, a]: Rgba, opacity: number): Rgba {
  return [r, g, b, Math.round(a * opacity)];
}

/** The bounding rect of a ring. */
function ringRect(ring: [number, number][]): Rect {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** A small count as a word: "one", "four". */
function countWord(n: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six"][n] ?? String(n);
}

/** The whole-scene composite, in the scene box. */
function sceneComposite(): Frame["composites"][number] {
  return { id: "scene", source: "overview", rect: SCENE_BOX, opacity: 1 };
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

  // The tile grids, in scene-box units.
  const levels = {
    b04: levelFor("b04"),
    b11: levelFor("b11"),
    b01: levelFor("b01"),
  };
  const toScene = (ring: [number, number][]) =>
    ring.map(([x, y]) => utmToScene(x, y));
  const grids = {
    b04: gridRings(levels.b04).map(toScene),
    b11: gridRings(levels.b11).map(toScene),
    b01: gridRings(levels.b01).map(toScene),
  };
  const storyRing = toScene(tileRing(levels.b04, STORY_TILE.x, STORY_TILE.y));
  const covers = {
    b11: tile.bands.b11.tiles.map(({ x, y }) =>
      toScene(tileRing(levels.b11, x, y)),
    ),
    b01: tile.bands.b01.tiles.map(({ x, y }) =>
      toScene(tileRing(levels.b01, x, y)),
    ),
  };
  /** A legend line beside the scene, for one band's grid. */
  const gridLegend = (band: BandId, y: number, opacity: number): Label =>
    label(
      `${band}-grid-legend`,
      `${BANDS[band].file} · ${BANDS[band].pixelSize} m: ${levels[band].matrixWidth} x ${levels[band].matrixHeight} tiles of ${BANDS[band].block} px, ${km(tileMeters(band))} each`,
      LEGEND_X,
      y,
      { color: css(BANDS[band].color), opacity, align: "left", size: 26 },
    );

  /** Step 3: the primary grid over the scene, and the story tile. */
  const primaryGridStep: StoryStep = {
    id: "primary-grid",
    title: "The primary grid",
    description: [
      `The finest band is the primary: its tile grid decides what gets drawn. At full resolution it has ${primaryGrid} x ${primaryGrid} tiles of ${BANDS.b04.block} x ${BANDS.b04.block} pixels, each ${km(tileMeters("b04"))} across. We'll follow one tile, (${STORY_TILE.x}, ${STORY_TILE.y}).`,
    ],
    durationMs: 1200,
    frame: (t) => {
      const frame = emptyFrame();
      frame.composites.push(sceneComposite());
      const gridIn = progress(t, 0, 600);
      const tileIn = progress(t, 600, 600);
      frame.polygons.push(
        {
          id: "grid-b04",
          rings: grids.b04,
          line: withAlpha(BANDS.b04.color, 0.85 * gridIn),
          lineWidth: 1.5,
        },
        {
          id: "story-tile",
          rings: [storyRing],
          fill: withAlpha(WHITE, 0.25 * tileIn),
          line: withAlpha(WHITE, tileIn),
          lineWidth: 3,
        },
      );
      frame.hud.labels.push(
        gridLegend("b04", LEGEND_Y, gridIn),
        label(
          "story-tile-legend",
          `Tile (${STORY_TILE.x}, ${STORY_TILE.y})`,
          LEGEND_X,
          LEGEND_Y + 50,
          { opacity: tileIn, align: "left", size: 26 },
        ),
      );
      frame.hud.caption = "The finest band's tiles drive the layer";
      return frame;
    },
  };

  /** Step 4: every band's own grid, and the tiles covering the story tile. */
  const bandGridsStep: StoryStep = {
    id: "band-grids",
    title: "Every band has its own tiles",
    description: [
      `The other bands have their own grids. A 20 m tile is ${BANDS.b11.block} pixels too, so it covers ${km(tileMeters("b11"))}: one 20 m tile covers the whole primary tile. The 60 m band uses ${BANDS.b01.block}-pixel tiles, ${km(tileMeters("b01"))} across, which don't line up with the 10 m grid, so the primary tile needs ${countWord(b01Count)} of them.`,
    ],
    durationMs: 2400,
    frame: (t) => {
      const frame = emptyFrame();
      frame.composites.push(sceneComposite());
      const b11In = progress(t, 0, 700);
      const b01In = progress(t, 700, 700);
      const coverIn = progress(t, 1500, 700);
      frame.polygons.push(
        {
          id: "grid-b04",
          rings: grids.b04,
          line: withAlpha(BANDS.b04.color, 0.35),
          lineWidth: 1,
        },
        {
          id: "grid-b11",
          rings: grids.b11,
          line: withAlpha(BANDS.b11.color, 0.85 * b11In),
          lineWidth: 1.5,
        },
        {
          id: "grid-b01",
          rings: grids.b01,
          line: withAlpha(BANDS.b01.color, 0.85 * b01In),
          lineWidth: 1.5,
        },
        // The 20 m tile shares two edges with the 60 m block: draw the block
        // wide underneath and the 20 m tile narrow on top, so both show.
        {
          id: "cover-b01",
          rings: covers.b01,
          line: withAlpha(BANDS.b01.color, coverIn),
          lineWidth: 7,
        },
        {
          id: "cover-b11",
          rings: covers.b11,
          line: withAlpha(BANDS.b11.color, coverIn),
          lineWidth: 3,
        },
        {
          id: "story-tile",
          rings: [storyRing],
          fill: withAlpha(WHITE, 0.25),
          line: WHITE,
          lineWidth: 3,
        },
      );
      frame.hud.labels.push(
        gridLegend("b04", LEGEND_Y, 1),
        gridLegend("b11", LEGEND_Y + 50, b11In),
        gridLegend("b01", LEGEND_Y + 100, b01In),
        label(
          "cover-legend",
          `Tile (${STORY_TILE.x}, ${STORY_TILE.y}) is covered by ${countWord(tile.bands.b11.tiles.length)} 20 m tile and ${countWord(b01Count)} 60 m tiles`,
          LEGEND_X,
          LEGEND_Y + 180,
          { opacity: coverIn, align: "left", size: 26 },
        ),
      );
      frame.hud.caption = "Each band has its own tile grid";
      return frame;
    },
  };

  /** The scene with the story tile and its covering tiles outlined. */
  const pushCoverage = (frame: Frame) => {
    frame.composites.push(sceneComposite());
    frame.polygons.push(
      {
        id: "cover-b01",
        rings: covers.b01,
        line: BANDS.b01.color,
        lineWidth: 5,
      },
      {
        id: "cover-b11",
        rings: covers.b11,
        line: BANDS.b11.color,
        lineWidth: 2.5,
      },
      {
        id: "story-tile",
        rings: [storyRing],
        fill: withAlpha(WHITE, 0.25),
        line: WHITE,
        lineWidth: 2.5,
      },
    );
  };

  /**
   * Where 60 m piece `i` sits in its slot: its share of the stitched
   * texture, with `gap` slide units between pieces.
   */
  const b01 = tile.bands.b01;
  const pieceRect = (i: number, gap: number): Rect => {
    const piece = scene.fetched.b01[i]!;
    const slot = TEXTURE_SLOTS.b01;
    const cols = new Set(b01.tiles.map(({ x }) => x)).size;
    const rows = new Set(b01.tiles.map(({ y }) => y)).size;
    const col = piece.x - b01.minCol;
    const row = piece.y - b01.minRow;
    const perTexelX = (slot.width - gap * (cols - 1)) / b01.stitchedWidth;
    const perTexelY = (slot.height - gap * (rows - 1)) / b01.stitchedHeight;
    return {
      x: slot.x + col * (gap + BANDS.b01.block * perTexelX),
      y: slot.y + row * (gap + BANDS.b01.block * perTexelY),
      width: piece.array.width * perTexelX,
      height: piece.array.height * perTexelY,
    };
  };

  /** The two label lines under a band's slot. */
  const slotLabels = (
    frame: Frame,
    band: BandId,
    detail: string,
    opacity: number,
  ) => {
    const slot = TEXTURE_SLOTS[band];
    frame.hud.labels.push(
      label(
        `${band}-slot-name`,
        bandName(band),
        slot.x + slot.width / 2,
        slot.y + slot.height + 30,
        {
          color: css(BANDS[band].color),
          opacity,
        },
      ),
      label(
        `${band}-slot-detail`,
        detail,
        slot.x + slot.width / 2,
        slot.y + slot.height + 60,
        {
          color: MUTED,
          opacity,
          size: 20,
        },
      ),
    );
  };

  const tileDetail = (band: "b04" | "b11") =>
    `${BANDS[band].block} x ${BANDS[band].block} px · ${km(tileMeters(band))}`;
  const piecesDetail = `${countWord(b01Count)} tiles of ${BANDS.b01.block} x ${BANDS.b01.block} px · ${km(tileMeters("b01"))} each`;
  const stitchedDetail = `stitched: ${b01.stitchedWidth} x ${b01.stitchedHeight} px`;

  /** Step 5: the covering tiles fly from the scene into the texture panel. */
  const fetchStep: StoryStep = {
    id: "fetch",
    title: "Fetch",
    description: [
      `For each band, the layer fetches the tiles that cover the primary tile: one 10 m tile, one 20 m tile and ${countWord(b01Count)} 60 m tiles. Each is ${BANDS.b04.block} or ${BANDS.b01.block} pixels on a side, but they cover very different ground.`,
    ],
    durationMs: 2400,
    frame: (t) => {
      const frame = emptyFrame();
      pushCoverage(frame);
      const flights: {
        id: string;
        image: ImageId;
        from: Rect;
        to: Rect;
        start: number;
      }[] = [
        {
          id: "b04-tile",
          image: "b04-tile",
          from: ringRect(storyRing),
          to: TEXTURE_SLOTS.b04,
          start: 0,
        },
        {
          id: "b11-tile",
          image: "b11-tile",
          from: ringRect(covers.b11[0]!),
          to: TEXTURE_SLOTS.b11,
          start: 350,
        },
        ...covers.b01.map((ring, i) => ({
          id: `b01-piece-${i}`,
          image: `b01-piece-${i}` as ImageId,
          from: ringRect(ring),
          to: pieceRect(i, PIECE_GAP),
          start: 700 + 120 * i,
        })),
      ];
      for (const flight of flights) {
        const p = progress(t, flight.start, FLIGHT_MS);
        frame.bitmaps.push({
          id: flight.id,
          image: flight.image,
          rect: flyRect(flight.from, flight.to, p),
          opacity: Math.min(1, p * 4),
        });
      }
      slotLabels(
        frame,
        "b04",
        tileDetail("b04"),
        progress(t, FLIGHT_MS - 200, 300),
      );
      slotLabels(
        frame,
        "b11",
        tileDetail("b11"),
        progress(t, 350 + FLIGHT_MS - 200, 300),
      );
      slotLabels(
        frame,
        "b01",
        piecesDetail,
        progress(t, 1060 + FLIGHT_MS - 200, 300),
      );
      frame.hud.caption = "Fetch the covering tiles";
      return frame;
    },
  };

  /** Step 6: the four 60 m tiles close up into one texture. */
  const stitchStep: StoryStep = {
    id: "stitch",
    title: "Stitch",
    description: [
      `The ${countWord(b01Count)} 60 m tiles are stitched into one ${b01.stitchedWidth} x ${b01.stitchedHeight} texture, so every band has exactly one texture to sample.`,
    ],
    durationMs: 1400,
    frame: (t) => {
      const frame = emptyFrame();
      pushCoverage(frame);
      const p = progress(t, 200, 900);
      frame.bitmaps.push(
        {
          id: "b04-tile",
          image: "b04-tile",
          rect: TEXTURE_SLOTS.b04,
          opacity: 1,
        },
        {
          id: "b11-tile",
          image: "b11-tile",
          rect: TEXTURE_SLOTS.b11,
          opacity: 1,
        },
        ...covers.b01.map((_, i) => ({
          id: `b01-piece-${i}`,
          image: `b01-piece-${i}` as ImageId,
          rect: flyRect(pieceRect(i, PIECE_GAP), pieceRect(i, 0), p),
          opacity: 1,
        })),
      );
      slotLabels(frame, "b04", tileDetail("b04"), 1);
      slotLabels(frame, "b11", tileDetail("b11"), 1);
      const stitched = progress(t, 1100, 300);
      slotLabels(frame, "b01", stitched < 1 ? piecesDetail : stitchedDetail, 1);
      frame.hud.caption = "Stitch them into one texture per band";
      return frame;
    },
  };

  /** The three textures in their slots, the 60 m one stitched. */
  const pushTextures = (frame: Frame) => {
    frame.bitmaps.push(
      {
        id: "b04-tile",
        image: "b04-tile",
        rect: TEXTURE_SLOTS.b04,
        opacity: 1,
      },
      {
        id: "b11-tile",
        image: "b11-tile",
        rect: TEXTURE_SLOTS.b11,
        opacity: 1,
      },
      ...covers.b01.map((_, i) => ({
        id: `b01-piece-${i}`,
        image: `b01-piece-${i}` as ImageId,
        rect: pieceRect(i, 0),
        opacity: 1,
      })),
    );
  };

  /** Step 7: each band's UV transform, as a rectangle on its texture. */
  const uvStep: StoryStep = {
    id: "uv",
    title: "Where the tile lands",
    description: [
      "Each band gets a UV transform: where the primary tile sits inside that band's texture, as an offset and a scale. The 10 m texture is the tile itself, ",
      { text: uvLabel(tile.bands.b04.uvTransform), emphasis: true },
      ". The tile is the top-left quarter of the 20 m texture, ",
      { text: uvLabel(tile.bands.b11.uvTransform), emphasis: true },
      ", and the middle ninth of the 60 m one, ",
      { text: uvLabel(tile.bands.b01.uvTransform), emphasis: true },
      ".",
    ],
    durationMs: 1400,
    frame: (t) => {
      const frame = emptyFrame();
      pushCoverage(frame);
      pushTextures(frame);
      BAND_IDS.forEach((band, i) => {
        const shown = progress(t, 300 * i, 400);
        const rect = uvRect(TEXTURE_SLOTS[band], tile.bands[band].uvTransform);
        frame.polygons.push({
          id: `uv-${band}`,
          rings: [rectRing(rect)],
          fill: withAlpha(WHITE, 0.2 * shown),
          line: withAlpha(WHITE, shown),
          lineWidth: 3,
        });
        slotLabels(frame, band, uvLabel(tile.bands[band].uvTransform), 1);
      });
      frame.hud.caption =
        "The UV transform: where the tile sits in each texture";
      return frame;
    },
  };

  const steps: StoryStep[] = [
    threeFiles,
    oneImage,
    primaryGridStep,
    bandGridsStep,
    fetchStep,
    stitchStep,
    uvStep,
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
