import { describe, expect, it } from "vitest";
import type { ReprojectionFns, SampleErrorContext } from "../src/delatin.js";
import { RasterReprojector } from "../src/delatin.js";

const identity: ReprojectionFns = {
  forwardTransform: (x, y) => [x, y],
  inverseTransform: (x, y) => [x, y],
  forwardReproject: (x, y) => [x, y],
  inverseReproject: (x, y) => [x, y],
};

// A reprojector whose per-sample error is a tunable constant, so we can change
// a scoring input after construction and verify _reevaluate re-scores cleanly.
class TunableReprojector extends RasterReprojector {
  error = 0;
  protected override _sampleError(_ctx: SampleErrorContext): number {
    return this.error ?? 0; // ?? 0: this field is undefined during super()'s seed flush
  }
  reevaluate(): void {
    this._reevaluate();
  }
}

describe("RasterReprojector._reevaluate", () => {
  it("re-scores existing triangles when a scoring input changes", () => {
    const r = new TunableReprojector(identity, 64, 64);
    expect(r.getMaxError()).toBe(0); // seeded with error = 0

    r.error = 5;
    r.reevaluate();
    expect(r.getMaxError()).toBe(5); // re-scored; no stale/duplicate entries
  });
});
