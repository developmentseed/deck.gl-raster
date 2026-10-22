import proj4 from "proj4";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metersPerUnit } from "../src/meters-per-unit.js";
import type { ProjJson } from "../src/projjson.js";
import {
  epsgResolver,
  PROJECTION_REGISTRY,
  registerProjection,
} from "../src/registry.js";

/** Minimal PROJJSON for a geographic CRS, what epsg.io returns for 4326. */
const WGS84_PROJJSON = {
  type: "GeographicCRS",
  name: "WGS 84",
  datum: {
    type: "GeodeticReferenceFrame",
    name: "World Geodetic System 1984",
    ellipsoid: {
      name: "WGS 84",
      semi_major_axis: 6378137,
      inverse_flattening: 298.257223563,
    },
  },
  coordinate_system: {
    subtype: "ellipsoidal",
    axis: [
      {
        name: "Geodetic latitude",
        abbreviation: "Lat",
        direction: "north",
        unit: "degree",
      },
      {
        name: "Geodetic longitude",
        abbreviation: "Lon",
        direction: "east",
        unit: "degree",
      },
    ],
  },
  id: { authority: "EPSG", code: 4326 },
} as unknown as ProjJson;

/** Stub fetch; by default it answers every request with WGS84_PROJJSON. */
function stubFetch(impl?: () => Promise<Response>) {
  const fetchMock = vi.fn(
    impl ?? (async () => new Response(JSON.stringify(WGS84_PROJJSON))),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  PROJECTION_REGISTRY.clear();
});

describe("epsgResolver", () => {
  it.each([4326, 3857, 4269, 32618, 32718])(
    "resolves EPSG:%i from proj4's own definitions without a request",
    async (code) => {
      const fetchMock = stubFetch(async () => {
        throw new Error("network must not be used");
      });
      const proj = await epsgResolver(code);
      expect(fetchMock).not.toHaveBeenCalled();

      // What the layers read from a definition.
      expect(proj.units).toBeDefined();
      expect(proj.datum?.a ?? proj.a).toBe(6378137);
      expect(
        metersPerUnit(proj.units as Parameters<typeof metersPerUnit>[0], {
          semiMajorAxis: proj.datum?.a ?? proj.a,
        }),
      ).toBeGreaterThan(0);

      // And it projects like proj4's own code.
      // @ts-expect-error proj4 typings don't cover wkt-parser output
      const fromDef = proj4(proj, "EPSG:3857").forward([-75, 40]);
      const fromCode = proj4(`EPSG:${code}`, "EPSG:3857").forward([-75, 40]);
      expect(fromDef[0]!).toBeCloseTo(fromCode[0]!, 3);
      expect(fromDef[1]!).toBeCloseTo(fromCode[1]!, 3);
    },
  );

  it("shares one request between concurrent resolutions of the same code", async () => {
    const fetchMock = stubFetch();
    const results = await Promise.all([
      epsgResolver(5070),
      epsgResolver(5070),
      epsgResolver(5070),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(
      "https://epsg.io/5070.json",
    );
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
    // A later call is served from the registry.
    await epsgResolver(5070);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed request instead of caching the failure", async () => {
    let attempts = 0;
    const fetchMock = stubFetch(async () => {
      attempts++;
      if (attempts === 1) {
        return new Response("nope", { status: 503 });
      }
      return new Response(JSON.stringify(WGS84_PROJJSON));
    });
    const first = Promise.all([epsgResolver(2193), epsgResolver(2193)]);
    await expect(first).rejects.toThrow("Failed to fetch PROJJSON");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(epsgResolver(2193)).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a projection registered by the application", async () => {
    const fetchMock = stubFetch(async () => {
      throw new Error("network must not be used");
    });
    registerProjection(2193, WGS84_PROJJSON);
    const proj = await epsgResolver(2193);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(proj.units).toBe("degree");
  });
});
