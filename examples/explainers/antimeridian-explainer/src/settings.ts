import type { StorySettings } from "./animation/story.js";
import { DEFAULT_STORY_SETTINGS } from "./animation/story.js";

/** Everything the presenter can tune. */
export type AppSettings = StorySettings & {
  /** Tolerance of the final mesh, in source pixels. One of {@link FINAL_MAX_ERROR_CHOICES}. */
  finalMaxError: number;
  /** Playback speed (1 = normal). */
  speed: number;
};

/**
 * Final mesh tolerances offered in the tuning panel, in source pixels.
 * This image barely distorts once unwrapped, so they're small (1 px:
 * 5 triangles; 0.0625 px: 68 triangles).
 */
export const FINAL_MAX_ERROR_CHOICES = [0.0625, 0.125, 0.25, 0.5, 1] as const;

/**
 * Default settings: the library's default tolerance, a 32-triangle final mesh,
 * at normal speed.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_STORY_SETTINGS,
  finalMaxError: 0.125,
  speed: 1,
};
