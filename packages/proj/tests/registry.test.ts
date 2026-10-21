import proj4 from "proj4";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_PROJJSON } from "../src/builtin-projjson.js";
import { epsgResolver, PROJECTION_REGISTRY } from "../src/registry.js";

/** A fetch stub that answers every request with the built-in PROJJSON for 4326. */
function stubFetch(impl?: () => Promise<Response>) {
  const fetchMock = vi.fn(
    impl ??
      (async () =>
        new Response(JSON.stringify(BUILTIN_PROJJSON.get(4326)), {
          headers: { "Content-Type": "application/json" },
        })),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  PROJECTION_REGISTRY.clear();
});

describe("epsgResolver", () => {
  it.each([4326, 3857, 4269])(
    "resolves EPSG:%i from the built-in table without a request",
    async (code) => {
      const fetchMock = stubFetch(async () => {
        throw new Error("network must not be used");
      });
      const proj = await epsgResolver(code);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(PROJECTION_REGISTRY.get(`EPSG:${code}`)).toBe(proj);

      // The built-in definition projects like proj4's own.
      // @ts-expect-error proj4 typings don't cover wkt-parser output
      const fromBuiltin = proj4(proj, "EPSG:3857").forward([-105, 40]);
      const fromProj4 = proj4(`EPSG:${code}`, "EPSG:3857").forward([-105, 40]);
      expect(fromBuiltin[0]!).toBeCloseTo(fromProj4[0]!, 3);
      expect(fromBuiltin[1]!).toBeCloseTo(fromProj4[1]!, 3);
    },
  );

  it("shares one request between concurrent resolutions of the same code", async () => {
    const fetchMock = stubFetch();
    const results = await Promise.all([
      epsgResolver(32618),
      epsgResolver(32618),
      epsgResolver(32618),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(
      "https://epsg.io/32618.json",
    );
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
    // A later call is served from the registry.
    await epsgResolver(32618);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed request instead of caching the failure", async () => {
    let attempts = 0;
    const fetchMock = stubFetch(async () => {
      attempts++;
      if (attempts === 1) {
        return new Response("nope", { status: 503 });
      }
      return new Response(JSON.stringify(BUILTIN_PROJJSON.get(4326)));
    });
    const first = Promise.all([epsgResolver(32633), epsgResolver(32633)]);
    await expect(first).rejects.toThrow("Failed to fetch PROJJSON");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(epsgResolver(32633)).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
