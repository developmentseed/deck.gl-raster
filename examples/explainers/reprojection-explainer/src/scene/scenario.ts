import type { ReprojectionFns } from "@developmentseed/raster-reproject";
import type { TextRun } from "../animation/story.js";

/** A parallel drawn in both panels and baked into the image. */
export type ReferenceParallel = {
  /** Latitude, in degrees. */
  lat: number;
  /** Longitudes it is drawn across, in degrees. */
  lngRange: [number, number];
  /** Label shown next to it. */
  label: string;
  /**
   * Points used to draw it on the map: 2 where it is straight there, more
   * where it curves. deck.gl restarts the dash pattern on every segment, so
   * each segment should stay longer than a dash.
   */
  targetSamples: number;
};

/** Values {@link Scenario.firstAttempt} can quote. */
export type FirstAttemptNumbers = {
  /** The 2-triangle mesh's largest error, rounded. */
  error: number;
  /** That error on the ground, rounded to 10 km. */
  errorKm: number;
  /** The error's unit, e.g. "input pixels". */
  pixels: string;
};

/** One image and target projection the explainer can animate. */
export type Scenario = {
  /** Stable id, used in the URL (`?scenario=`). */
  id: string;
  /** Name in the tuning panel. */
  label: string;
  /** URL of the image (an imported asset). */
  imageUrl: string;
  /** Image width, in pixels. */
  width: number;
  /** Image height, in pixels. */
  height: number;
  /** Source pixel ↔ source CRS ↔ target CRS, as `RasterReprojector` needs. */
  fns: ReprojectionFns;
  /** Longitude, latitude (degrees) → source pixel. */
  lngLatToPixel(lng: number, lat: number): [number, number];
  /** Longitude, latitude (degrees) → target CRS. */
  lngLatToTarget(lng: number, lat: number): [number, number];
  /** Name of the source projection, under the source panel's title. */
  sourceName: string;
  /** Name of the target projection, under the target panel's title. */
  targetName: string;
  /** The parallel the animation tracks. */
  parallel: ReferenceParallel;
  /** Points per image edge in the dashed outline on the map. */
  outlineSamples: number;
  /** Ground size of one source pixel near the image center, in km. */
  kmPerPixel: number;
  /** Final mesh tolerances offered in the tuning panel, in pixels. */
  maxErrorChoices: readonly number[];
  /** Final mesh tolerance used when the scenario is picked, in pixels. */
  defaultMaxError: number;
  /** Credit for the image, shown under the source panel, if it needs one. */
  credit?: { text: string; href: string };
  /** Description of step 1. */
  introduction: TextRun[];
  /** Description of step 3, quoting the 2-triangle mesh's error. */
  firstAttempt(numbers: FirstAttemptNumbers): TextRun[];
};
