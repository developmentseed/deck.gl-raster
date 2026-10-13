import type { StorySettings } from "./animation/story.js";
import { DEFAULT_STORY_SETTINGS } from "./animation/story.js";
import { DEFAULT_SCENARIO } from "./scene/scenarios.js";

/** Everything the presenter can tune. */
export type AppSettings = StorySettings & {
  /** Id of the scenario being animated. */
  scenario: string;
  /**
   * Tolerance of the final mesh, in pixels. One of the scenario's
   * `maxErrorChoices`.
   */
  finalMaxError: number;
  /** Playback speed (1 = normal). */
  speed: number;
};

/** Default settings: the NLCD scenario's 194-triangle mesh at normal speed. */
export const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_STORY_SETTINGS,
  scenario: DEFAULT_SCENARIO.id,
  finalMaxError: DEFAULT_SCENARIO.defaultMaxError,
  speed: 1,
};
