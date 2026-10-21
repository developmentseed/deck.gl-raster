import type { Frame } from "./frame.js";
import { emptyFrame } from "./frame.js";

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

const PLACEHOLDER_TITLES = [
  "Three files, one scene",
  "One image",
  "The primary grid",
  "Every band has its own tiles",
  "Fetch",
  "Stitch",
  "Where the tile lands",
  "Sample",
  "The tile on the map",
];

/** The story, before its steps draw anything. */
export function createPlaceholderStory(): StoryStep[] {
  return PLACEHOLDER_TITLES.map((title, i) => ({
    id: `step-${i}`,
    title,
    description: [],
    durationMs: 0,
    frame: () => emptyFrame(),
  }));
}
