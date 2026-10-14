import { describe, expect, it } from "vitest";
import { renderDebugTileOutline } from "../src/layer-utils.js";

/** Wrap a longitude into [−180°, 180°], as proj4 does. */
const wrapLng = (lng: number) =>
  Math.abs(lng) <= 180 ? lng : lng - Math.sign(lng) * 360;

/** A tile whose corners, in its source CRS, span `west` to `east`. */
function tile(west: number, east: number) {
  return {
    index: { x: 0, y: 0, z: 0 },
    projectedCorners: {
      topLeft: [west, 24],
      topRight: [east, 24],
      bottomLeft: [west, -18],
      bottomRight: [east, -18],
    },
  } as unknown as Parameters<typeof renderDebugTileOutline>[1];
}

/** The outline's path and whether deck.gl splits it at ±180°. */
function outline(
  west: number,
  east: number,
  forwardTo4326: (x: number, y: number) => [number, number],
) {
  const [outlineLayer] = renderDebugTileOutline(
    "debug",
    tile(west, east),
    forwardTo4326,
  );
  const props = outlineLayer!.props as unknown as {
    data: [number, number][][];
    wrapLongitude: boolean;
  };
  return { path: props.data[0]!, wrapLongitude: props.wrapLongitude };
}

const lngsOf = (path: [number, number][]) => path.map(([lng]) => lng);

/** The largest jump in longitude between consecutive points. */
const largestStep = (lngs: number[]) =>
  Math.max(...lngs.slice(1).map((lng, i) => Math.abs(lng - lngs[i]!)));

describe("renderDebugTileOutline", () => {
  it("outlines a tile across the antimeridian the short way", () => {
    // Its corners come back from the projection at 156°E and 162°W.
    const { path, wrapLongitude } = outline(-204, -162, (x, y) => [
      wrapLng(x),
      y,
    ]);
    const lngs = lngsOf(path);
    expect(Math.max(...lngs) - Math.min(...lngs)).toBeCloseTo(42, 9);
    expect(largestStep(lngs)).toBeLessThan(180);
    // deck.gl then cuts the path at ±180°.
    expect(wrapLongitude).toBe(true);
  });

  it("outlines a whole-world tile a whole world wide", () => {
    const { path } = outline(-180, 180, (x, y) => [x, y]);
    const lngs = lngsOf(path);
    expect(Math.max(...lngs) - Math.min(...lngs)).toBeCloseTo(360, 9);
    // Every step is the short way around, so deck.gl doesn't collapse it.
    expect(largestStep(lngs)).toBeLessThan(180);
  });

  it("still joins the corners with straight lines", () => {
    const { path } = outline(10, 20, (x, y) => [x, y]);
    expect(path).toEqual([
      [10, 24],
      [20, 24],
      [20, -18],
      [10, -18],
      [10, 24],
    ]);
  });
});
