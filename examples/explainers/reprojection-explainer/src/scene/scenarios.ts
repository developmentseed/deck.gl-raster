import { ARCTIC_SCENARIO } from "./arctic.js";
import { NLCD_SCENARIO } from "./nlcd.js";
import type { Scenario } from "./scenario.js";

/** Every scenario the explainer offers, in tuning-panel order. */
export const SCENARIOS: readonly Scenario[] = [NLCD_SCENARIO, ARCTIC_SCENARIO];

/** The scenario shown when the URL names none (or an unknown one). */
export const DEFAULT_SCENARIO: Scenario = NLCD_SCENARIO;

/** The scenario with this id, or the default. */
export function scenarioById(id: string | null | undefined): Scenario {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? DEFAULT_SCENARIO;
}
