import {
  _GlobeViewport as GlobeViewport,
  WebMercatorViewport,
} from "@deck.gl/core";
import { describe, expect, it } from "vitest";
import type { Bounds } from "../../src/raster-tileset/types.js";
import { visibleWorldBounds } from "../../src/raster-tileset/visible-world-bounds.js";

/** The west and east edge of each box, to 6 decimals. */
function longitudes(boxes: Bounds[]): [number, number][] {
  const round = (x: number) => Math.round(x * 1e6) / 1e6;
  return boxes.map((box) => [round(box[0]), round(box[2])]);
}

// A pixel at zoom 6 is 360° / 32768, so this view reaches 4.39453125° to each
// side of its center.
const view = { latitude: 0, zoom: 6, width: 800, height: 600 };

describe("visibleWorldBounds", () => {
  it("splits Web Mercator bounds with repeat at the antimeridian", () => {
    const viewport = new WebMercatorViewport({
      ...view,
      longitude: 179.9,
      repeat: true,
    });
    expect(longitudes(visibleWorldBounds(viewport))).toEqual([
      [175.505469, 180],
      [-180, -175.705469],
    ]);
  });

  it("moves Web Mercator bounds with repeat back into the world", () => {
    // Centered at -179.9°, the view runs from -184.29° to -175.51°.
    const viewport = new WebMercatorViewport({
      ...view,
      longitude: -179.9,
      repeat: true,
    });
    expect(longitudes(visibleWorldBounds(viewport))).toEqual([
      [175.705469, 180],
      [-180, -175.505469],
    ]);
  });

  it("moves bounds around a center longitude that isn't wrapped", () => {
    // Controllers wrap the center into [-180, 180], but a view state set
    // directly can be anywhere. 899.9° is 179.9°, two worlds east.
    const viewport = new WebMercatorViewport({
      ...view,
      longitude: 899.9,
      repeat: true,
    });
    expect(longitudes(visibleWorldBounds(viewport))).toEqual([
      [175.505469, 180],
      [-180, -175.705469],
    ]);
  });

  it("returns the whole world when Web Mercator shows more than one world", () => {
    const viewport = new WebMercatorViewport({
      longitude: 0,
      latitude: 0,
      zoom: 0,
      width: 3000,
      height: 800,
      repeat: true,
    });
    expect(longitudes(visibleWorldBounds(viewport))).toEqual([[-180, 180]]);
  });

  it("splits globe bounds at the antimeridian", () => {
    const viewport = new GlobeViewport({ ...view, longitude: 179.9 });
    const boxes = visibleWorldBounds(viewport);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]![2]).toBe(180);
    expect(boxes[1]![0]).toBe(-180);
  });

  it("returns Web Mercator bounds without repeat as they are", () => {
    const viewport = new WebMercatorViewport({ ...view, longitude: 179.9 });
    expect(longitudes(visibleWorldBounds(viewport))).toEqual([
      [175.505469, 184.294531],
    ]);
  });
});
