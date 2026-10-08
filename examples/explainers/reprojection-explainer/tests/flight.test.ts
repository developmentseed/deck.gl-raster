import { describe, expect, it } from "vitest";
import type { FlightOptions, FlightPaths } from "../src/animation/flight.js";
import {
  eastFirstDelays,
  flightDuration,
  flightPositions,
} from "../src/animation/flight.js";

// One triangle: source at x≈0, copy at x≈100, target at x≈200 (and a bit lower).
const PATHS: FlightPaths = {
  source: Float32Array.from([0, 0, 10, 0, 0, 10]),
  copy: Float32Array.from([100, 0, 110, 0, 100, 10]),
  target: Float32Array.from([200, 5, 212, 5, 200, 15]),
};
const DIRECT: FlightOptions = {
  style: "direct",
  durationMs: 1000,
  arcHeight: 0,
  snapDelayMs: 200,
  snapDurationMs: 500,
};
const SNAP: FlightOptions = { ...DIRECT, style: "fly-then-snap" };
const NO_DELAY = Float32Array.from([0]);

describe("eastFirstDelays", () => {
  it("launches the eastmost triangle first", () => {
    expect(Array.from(eastFirstDelays([0, 10, 5], 100))).toEqual([100, 0, 50]);
  });

  it("launches everything at once when all centroids line up", () => {
    expect(Array.from(eastFirstDelays([3, 3], 100))).toEqual([0, 0]);
  });
});

describe("flightDuration", () => {
  it("is the last launch plus one flight for direct flights", () => {
    expect(flightDuration([0, 300], DIRECT)).toBe(1300);
  });

  it("adds the snap for fly-then-snap", () => {
    expect(flightDuration([0, 300], SNAP)).toBe(1300 + 200 + 500);
  });
});

describe("flightPositions", () => {
  it("starts at the source", () => {
    expect(Array.from(flightPositions(PATHS, NO_DELAY, 0, DIRECT))).toEqual(
      Array.from(PATHS.source),
    );
  });

  it("ends at the target when flying direct", () => {
    expect(Array.from(flightPositions(PATHS, NO_DELAY, 1000, DIRECT))).toEqual(
      Array.from(PATHS.target),
    );
  });

  it("waits for its launch time", () => {
    const delayed = Float32Array.from([500]);
    expect(Array.from(flightPositions(PATHS, delayed, 400, DIRECT))).toEqual(
      Array.from(PATHS.source),
    );
  });

  it("lifts triangles on an upward (−y) arc mid-flight", () => {
    const flat = flightPositions(PATHS, NO_DELAY, 500, DIRECT);
    const arced = flightPositions(PATHS, NO_DELAY, 500, {
      ...DIRECT,
      arcHeight: 40,
    });
    expect(arced[1]).toBeCloseTo(flat[1]! - 40, 4);
  });

  it("lands on the copy, then snaps to the target, for fly-then-snap", () => {
    expect(Array.from(flightPositions(PATHS, NO_DELAY, 1100, SNAP))).toEqual(
      Array.from(PATHS.copy),
    );
    expect(Array.from(flightPositions(PATHS, NO_DELAY, 1700, SNAP))).toEqual(
      Array.from(PATHS.target),
    );
  });
});
