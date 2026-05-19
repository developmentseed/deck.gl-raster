import { describe, expect, it } from "vitest";
import { COGLayer } from "../src/cog-layer.js";
import { defaultConcurrencyLimiter } from "../src/default-concurrency-limiter.js";
import { MultiCOGLayer } from "../src/multi-cog-layer.js";

describe("COGLayer default concurrencyLimiter", () => {
  it("defaultProps.concurrencyLimiter is the shared module-level instance", () => {
    // @ts-expect-error — defaultProps is cast to the base type at the
    // declaration site, so the field isn't visible on its static type. The
    // *value* is still the one we want.
    expect(COGLayer.defaultProps.concurrencyLimiter).toBe(
      defaultConcurrencyLimiter,
    );
  });
});

describe("MultiCOGLayer default concurrencyLimiter", () => {
  it("defaultProps.concurrencyLimiter is the same shared instance as COGLayer's", () => {
    // @ts-expect-error — see COGLayer test above
    expect(MultiCOGLayer.defaultProps.concurrencyLimiter).toBe(
      defaultConcurrencyLimiter,
    );
    // @ts-expect-error
    expect(MultiCOGLayer.defaultProps.concurrencyLimiter).toBe(
      // @ts-expect-error
      COGLayer.defaultProps.concurrencyLimiter,
    );
  });
});
