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
 * Bounded so the recorded refinement stays small (32 px: 24 triangles;
 * 1 px: 802 triangles).
 */
export const FINAL_MAX_ERROR_CHOICES = [1, 2, 4, 8, 16, 32] as const;

/** Default settings: a 194-triangle final mesh at normal speed. */
export const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_STORY_SETTINGS,
  finalMaxError: 4,
  speed: 1,
};
