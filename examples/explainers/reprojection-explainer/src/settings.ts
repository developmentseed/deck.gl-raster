import type { StorySettings } from "./animation/story.js";
import { DEFAULT_STORY_SETTINGS } from "./animation/story.js";
import { DEFAULT_SCENARIO, scenarioById } from "./scene/scenarios.js";

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

/**
 * Settings for a page URL's query string: the scenario named by
 * `?scenario=` (at its default tolerance), otherwise the defaults.
 */
export function settingsFromUrl(search: string): AppSettings {
  const scenario = scenarioById(new URLSearchParams(search).get("scenario"));
  return {
    ...DEFAULT_SETTINGS,
    scenario: scenario.id,
    finalMaxError: scenario.defaultMaxError,
  };
}

/**
 * `href` with the settings that belong in a shareable link written into its
 * query string. Defaults are left out, so the default view keeps a clean URL.
 */
export function urlWithSettings(href: string, settings: AppSettings): string {
  const url = new URL(href);
  if (settings.scenario === DEFAULT_SCENARIO.id) {
    url.searchParams.delete("scenario");
  } else {
    url.searchParams.set("scenario", settings.scenario);
  }
  return url.toString();
}
