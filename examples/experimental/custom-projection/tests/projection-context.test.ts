import type { RasterTilesetDescriptor } from "@developmentseed/deck.gl-raster";
import { describe, expect, it } from "vitest";
import {
  CustomProjectionViewport,
  resolveCRS,
} from "../src/custom-projection/index.js";
import {
  createProjectionContext,
  lngLatDomain,
} from "../src/projected-cog-layer/projection-context.js";
import { PROJECTIONS } from "../src/projections.js";

const identity = (x: number, y: number): [number, number] => [x, y];

/** A raster in WGS84 lng/lat. Only its CRS functions are used here. */
const GEOGRAPHIC = {
  projectTo4326: identity,
  projectFrom4326: identity,
} as unknown as RasterTilesetDescriptor;

async function presetCRS(presetId: string) {
  const preset = PROJECTIONS.find((p) => p.id === presetId)!;
  return resolveCRS(preset.crs);
}

async function presetContext(presetId: string) {
  const viewport = new CustomProjectionViewport({
    crs: await presetCRS(presetId),
    width: 800,
    height: 600,
  });
  return createProjectionContext(viewport, GEOGRAPHIC);
}

describe("lngLatDomain", () => {
  it("derives each preset's lng/lat domain from its CRS", async () => {
    const expected: Record<string, number[]> = {
      arctic: [-180, -60, 180, 90],
      antarctic: [-180, -90, 180, 60],
      "equal-earth": [-180, -90, 180, 90],
      "web-mercator": [-180, -85.0511287798066, 180, 85.0511287798066],
    };
    for (const [presetId, bounds] of Object.entries(expected)) {
      const crs = await presetCRS(presetId);
      const domain = lngLatDomain(crs.converter.WGS84);
      domain.forEach((value, i) => {
        expect(value, `${presetId}[${i}]`).toBeCloseTo(bounds[i]!, 6);
      });
    }
  });
});

describe("createProjectionContext", () => {
  it("takes its domain from the view's CRS", async () => {
    const { domain } = await presetContext("arctic");
    expect(domain[1]).toBeCloseTo(-60, 6);
  });

  it("clamps an out-of-domain inverse to the domain", async () => {
    // Far outside the Arctic map, where the inverse lands near the South Pole.
    const lngLat = (await presetContext("arctic")).mapToLngLat(1e8, 1e8);
    expect(lngLat?.[0]).toBeCloseTo(90, 6);
    expect(lngLat?.[1]).toBeCloseTo(-60, 6);
  });

  it("rejects an inverse that throws", async () => {
    // Above Equal Earth's top edge, where math.gl's inverse throws.
    expect(
      (await presetContext("equal-earth")).mapToLngLat(1e8, 1e8),
    ).toBeNull();
  });
});
