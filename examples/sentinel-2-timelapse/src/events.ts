/**
 * Preset disaster events — "quick starts" for the search form.
 *
 * A preset does NOT hardcode the imagery. It pre-fills the search form (dates,
 * cloud threshold, collection) and flies the map to the event. The app then
 * runs a live STAC search over whatever the map is currently showing, so the
 * user can pan/zoom and re-search from any starting point.
 *
 * Each event's coverage was checked against Earth Search; the scene counts in
 * the comments are the low-cloud acquisitions found for the best MGRS tile.
 */

import type { Collection } from "./stac.js";
import { DEFAULT_PRESET_ID } from "./composites.js";

export type DisasterEvent = {
  id: string;
  title: string;
  /** Map camera to fly to before searching. */
  center: { longitude: number; latitude: number; zoom: number };
  /** Pre-filled date range, "YYYY-MM-DD". */
  startDate: string;
  endDate: string;
  /** Pre-filled cloud-cover ceiling (percent). */
  cloudCoverMax: number;
  /** Which collection covers this event's dates well. */
  collection: Collection;
  /** Composite preset to start on (id from `composites.ts`). */
  presetId: string;
};

export const EVENTS: DisasterEvent[] = [
  {
    // 11 complete, low-cloud scenes Aug 1 (pre-flood) -> Oct 15 (recovery) on
    // MGRS-42RVR. Center is placed in that tile because it frames a contiguous
    // stretch of the flooded Indus; neighboring MGRS-42RUQ has more passes but
    // every frame is a partial swath, so completeness rules it out.
    id: "pakistan-2022-floods",
    title: "Pakistan floods — Sindh, 2022",
    center: { longitude: 68.5, latitude: 27.5, zoom: 8.5 },
    startDate: "2022-08-01",
    endDate: "2022-10-15",
    cloudCoverMax: 20,
    collection: "sentinel-2-l2a",
    presetId: "swir-water",
  },
  {
    // 4 complete, low-cloud scenes Jan -> late Feb on MGRS-11SLT, the tile that
    // covers both the coastal Palisades and the Eaton (Altadena) burn scars.
    // The northern MGRS-11SLU has more passes but doesn't contain the fires.
    id: "la-fires-2025",
    title: "Los Angeles fires — Jan 2025",
    center: { longitude: -118.4, latitude: 34.13, zoom: 9 },
    startDate: "2025-01-01",
    endDate: "2025-03-01",
    cloudCoverMax: 20,
    collection: "sentinel-2-l2a",
    presetId: "burned-area",
  },
];

export const DEFAULT_EVENT = EVENTS[0];
export { DEFAULT_PRESET_ID };
