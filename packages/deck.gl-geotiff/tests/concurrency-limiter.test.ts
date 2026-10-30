import { describe, expect, it } from "vitest";
import { DEFAULT_CONCURRENCY_LIMITER } from "../src/default-concurrency-limiter.js";
import { MosaicLayer } from "../src/mosaic-layer/mosaic-layer.js";

describe("MosaicLayer default concurrencyLimiter", () => {
  it("defaultProps.concurrencyLimiter is the same shared instance", () => {
    expect(MosaicLayer.defaultProps.concurrencyLimiter).toBe(
      DEFAULT_CONCURRENCY_LIMITER,
    );
  });
});
