# Cutline Bbox Shader Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `CutlineBbox` GPU shader module to `@developmentseed/deck.gl-raster` that discards fragments outside a WGS84 axis-aligned bbox, for rendering rasters with a "map collar" (e.g. USGS historical topographic maps).

**Architecture:** Single `ShaderModule` file, fragment-shader-only injection. `getUniforms` converts the user's WGS84 bbox into deck.gl Web Mercator common space via `lngLatToWorld` from `@math.gl/web-mercator`. The shader reads deck.gl's existing `position_commonspace` varying and runs four scalar comparisons. Mercator-only; a comment at the injection site notes the globe path. Opt-in via a custom `renderTile` callback on `COGLayer` — not wired into `inferRenderPipeline`.

**Tech Stack:** TypeScript, `@luma.gl/shadertools` (`ShaderModule` type), `@math.gl/web-mercator` (`lngLatToWorld`), vitest, Biome.

**Spec:** [dev-docs/specs/2026-04-14-cutline-bbox-shader-module-design.md](../specs/2026-04-14-cutline-bbox-shader-module-design.md)

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `packages/deck.gl-raster/src/gpu-modules/cutline-bbox.ts` | `CutlineBbox` shader module + `CutlineBboxProps` type |
| `packages/deck.gl-raster/tests/gpu-modules/cutline-bbox.test.ts` | Unit tests for `getUniforms`, validation errors, and module metadata |

### Modified files

| File | Change |
|------|--------|
| `packages/deck.gl-raster/src/gpu-modules/index.ts` | Export `CutlineBbox` and `CutlineBboxProps` |

---

## Task 1: CutlineBbox module and tests (TDD)

**Files:**
- Create: `packages/deck.gl-raster/src/gpu-modules/cutline-bbox.ts`
- Create: `packages/deck.gl-raster/tests/gpu-modules/cutline-bbox.test.ts`

**Context for the implementer:**

This task follows strict TDD: write a failing test, see it fail for the right reason, write the minimum code to pass, repeat. **Do not batch all the tests and then implement everything at once.**

The module mirrors the shape of [filter-nodata.ts](../../packages/deck.gl-raster/src/gpu-modules/filter-nodata.ts) and [mask-texture.ts](../../packages/deck.gl-raster/src/gpu-modules/mask-texture.ts). Study those for the exact `ShaderModule` object shape before starting.

Existing test conventions come from [composite-bands.test.ts](../../packages/deck.gl-raster/tests/gpu-modules/composite-bands.test.ts): vitest, `describe`/`it`/`expect`, relative imports to `../../src/gpu-modules/...` with a `.js` extension.

**Important y-axis note:** `lngLatToWorld` from `@math.gl/web-mercator` returns `[x, y]` where the y-direction sign convention should be verified at implementation time by running a quick sanity check (e.g. `lngLatToWorld([0, 10])` vs `lngLatToWorld([0, -10])`). The tests and `getUniforms` use `Math.min`/`Math.max` to pack the uniform so the shader's `< ` / `>` comparison works regardless of which corner lngLatToWorld places first. The shader compares `position_commonspace.xy` against `[minX, minY, maxX, maxY]`.

---

- [ ] **Step 1: Create the empty test file**

Create `packages/deck.gl-raster/tests/gpu-modules/cutline-bbox.test.ts` with only imports and an empty describe block:

```ts
import { lngLatToWorld } from "@math.gl/web-mercator";
import { describe, expect, it } from "vitest";
import { CutlineBbox } from "../../src/gpu-modules/cutline-bbox.js";

describe("CutlineBbox", () => {
  // tests go here
});
```

- [ ] **Step 2: Write the first failing test — getUniforms produces common-space bbox from WGS84 input**

Add inside `describe("CutlineBbox", ...)`:

```ts
it("getUniforms converts a WGS84 bbox to deck.gl common space via lngLatToWorld", () => {
  // Abbeville East 7.5' quad, from USGS metadata CSV
  const west = -85.25;
  const south = 31.5;
  const east = -85.125;
  const north = 31.625;

  const [swX, swY] = lngLatToWorld([west, south]);
  const [neX, neY] = lngLatToWorld([east, north]);
  const expectedMinX = Math.min(swX, neX);
  const expectedMinY = Math.min(swY, neY);
  const expectedMaxX = Math.max(swX, neX);
  const expectedMaxY = Math.max(swY, neY);

  const uniforms = CutlineBbox.getUniforms({
    bbox: [west, south, east, north],
  });

  expect(uniforms.bbox).toEqual([
    expectedMinX,
    expectedMinY,
    expectedMaxX,
    expectedMaxY,
  ]);
});
```

- [ ] **Step 3: Run the test and verify it fails because the module does not exist**

Run:

```bash
cd packages/deck.gl-raster && pnpm vitest run tests/gpu-modules/cutline-bbox.test.ts
```

Expected: test suite fails to load with a "Cannot find module '../../src/gpu-modules/cutline-bbox.js'" or similar error from the vitest module resolver. This confirms the test is wired up correctly.

- [ ] **Step 4: Create the minimal module to make the first test pass**

Create `packages/deck.gl-raster/src/gpu-modules/cutline-bbox.ts`:

```ts
import type { ShaderModule } from "@luma.gl/shadertools";
import { lngLatToWorld } from "@math.gl/web-mercator";

export type CutlineBboxProps = {
  /**
   * WGS84 axis-aligned bbox as `[west, south, east, north]` in degrees.
   *
   * Must satisfy `east > west` (antimeridian crossing is not supported) and
   * `north > south`. Latitudes must lie within the Web Mercator limits
   * (±85.051129°).
   */
  bbox: [number, number, number, number];
};

const MODULE_NAME = "cutlineBbox";

const uniformBlock = `\
uniform ${MODULE_NAME}Uniforms {
  vec4 bbox;
} ${MODULE_NAME};
`;

/**
 * A shader module that discards fragments whose position falls outside a
 * WGS84 axis-aligned bbox.
 *
 * Intended for rendering rasters with a "map collar" (e.g. USGS historical
 * topographic maps) where the valid data area is described as a lat/lng bbox
 * but the raw pixels include surrounding metadata.
 *
 * Only supports rendering in a `WebMercatorViewport`. The caller is
 * responsible for enforcing this in application code; the module itself does
 * not have viewport access.
 */
export const CutlineBbox = {
  name: MODULE_NAME,
  fs: uniformBlock,
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      // Globe support: when rendering in a GlobeView, position_commonspace is
      // on the unit sphere rather than in Web Mercator common space. A future
      // globe code path would need a different varying (e.g. lng/lat passed
      // through from the vertex shader) and a matching uniform layout.
      vec2 p = position_commonspace.xy;
      if (p.x < ${MODULE_NAME}.bbox.x || p.x > ${MODULE_NAME}.bbox.z ||
          p.y < ${MODULE_NAME}.bbox.y || p.y > ${MODULE_NAME}.bbox.w) {
        discard;
      }
    `,
  },
  uniformTypes: {
    bbox: "vec4<f32>",
  },
  getUniforms: (props: Partial<CutlineBboxProps>) => {
    const bbox = props.bbox;
    if (!bbox) {
      return {};
    }
    const [west, south, east, north] = bbox;
    const [swX, swY] = lngLatToWorld([west, south]);
    const [neX, neY] = lngLatToWorld([east, north]);
    return {
      bbox: [
        Math.min(swX, neX),
        Math.min(swY, neY),
        Math.max(swX, neX),
        Math.max(swY, neY),
      ],
    };
  },
} as const satisfies ShaderModule<CutlineBboxProps>;
```

- [ ] **Step 5: Run the test and verify it passes**

Run:

```bash
cd packages/deck.gl-raster && pnpm vitest run tests/gpu-modules/cutline-bbox.test.ts
```

Expected: 1 passed, 0 failed.

- [ ] **Step 6: Add a failing test for the no-op case (missing bbox prop)**

Add inside the `describe` block:

```ts
it("getUniforms returns an empty object when bbox is not provided", () => {
  expect(CutlineBbox.getUniforms({})).toEqual({});
});
```

- [ ] **Step 7: Run the test and verify it passes**

Run:

```bash
cd packages/deck.gl-raster && pnpm vitest run tests/gpu-modules/cutline-bbox.test.ts
```

Expected: 2 passed. The existing guard `if (!bbox) return {};` already covers this.

- [ ] **Step 8: Add a failing test for antimeridian crossing rejection**

Add inside the `describe` block:

```ts
it("getUniforms throws when east <= west", () => {
  expect(() =>
    CutlineBbox.getUniforms({ bbox: [10, 0, -10, 1] }),
  ).toThrow(/east > west/);

  expect(() =>
    CutlineBbox.getUniforms({ bbox: [5, 0, 5, 1] }),
  ).toThrow(/east > west/);
});
```

- [ ] **Step 9: Run the test and verify it fails**

Run:

```bash
cd packages/deck.gl-raster && pnpm vitest run tests/gpu-modules/cutline-bbox.test.ts
```

Expected: the new test fails because no validation exists yet. The previous two tests still pass.

- [ ] **Step 10: Add antimeridian validation to getUniforms**

In `cutline-bbox.ts`, replace the body of `getUniforms` after the `[west, south, east, north] = bbox;` destructure, so it reads:

```ts
  getUniforms: (props: Partial<CutlineBboxProps>) => {
    const bbox = props.bbox;
    if (!bbox) {
      return {};
    }
    const [west, south, east, north] = bbox;
    if (!(east > west)) {
      throw new Error(
        `CutlineBbox: bbox must have east > west (antimeridian crossing is not supported); got west=${west}, east=${east}`,
      );
    }
    const [swX, swY] = lngLatToWorld([west, south]);
    const [neX, neY] = lngLatToWorld([east, north]);
    return {
      bbox: [
        Math.min(swX, neX),
        Math.min(swY, neY),
        Math.max(swX, neX),
        Math.max(swY, neY),
      ],
    };
  },
```

- [ ] **Step 11: Run the test and verify it passes**

Run:

```bash
cd packages/deck.gl-raster && pnpm vitest run tests/gpu-modules/cutline-bbox.test.ts
```

Expected: 3 passed.

- [ ] **Step 12: Add a failing test for north <= south rejection**

Add inside the `describe` block:

```ts
it("getUniforms throws when north <= south", () => {
  expect(() =>
    CutlineBbox.getUniforms({ bbox: [-10, 20, 10, 10] }),
  ).toThrow(/north > south/);

  expect(() =>
    CutlineBbox.getUniforms({ bbox: [-10, 15, 10, 15] }),
  ).toThrow(/north > south/);
});
```

- [ ] **Step 13: Run the test and verify it fails**

Run:

```bash
cd packages/deck.gl-raster && pnpm vitest run tests/gpu-modules/cutline-bbox.test.ts
```

Expected: the new test fails. Previous tests still pass.

- [ ] **Step 14: Add north > south validation**

In `cutline-bbox.ts`, add after the antimeridian check:

```ts
    if (!(north > south)) {
      throw new Error(
        `CutlineBbox: bbox must have north > south; got south=${south}, north=${north}`,
      );
    }
```

- [ ] **Step 15: Run the test and verify it passes**

Run:

```bash
cd packages/deck.gl-raster && pnpm vitest run tests/gpu-modules/cutline-bbox.test.ts
```

Expected: 4 passed.

- [ ] **Step 16: Add a failing test for Web Mercator latitude limits**

Add inside the `describe` block:

```ts
it("getUniforms throws when latitudes exceed Web Mercator limits", () => {
  expect(() =>
    CutlineBbox.getUniforms({ bbox: [-10, -86, 10, 0] }),
  ).toThrow(/Web Mercator/);

  expect(() =>
    CutlineBbox.getUniforms({ bbox: [-10, 0, 10, 86] }),
  ).toThrow(/Web Mercator/);
});
```

- [ ] **Step 17: Run the test and verify it fails**

Run:

```bash
cd packages/deck.gl-raster && pnpm vitest run tests/gpu-modules/cutline-bbox.test.ts
```

Expected: the new test fails.

- [ ] **Step 18: Add latitude limit validation**

In `cutline-bbox.ts`, add after the north > south check:

```ts
    const MERCATOR_LAT_LIMIT = 85.051129;
    if (
      south < -MERCATOR_LAT_LIMIT ||
      south > MERCATOR_LAT_LIMIT ||
      north < -MERCATOR_LAT_LIMIT ||
      north > MERCATOR_LAT_LIMIT
    ) {
      throw new Error(
        `CutlineBbox: bbox latitudes must be within Web Mercator limits (±${MERCATOR_LAT_LIMIT}°); got south=${south}, north=${north}`,
      );
    }
```

- [ ] **Step 19: Run the test and verify it passes**

Run:

```bash
cd packages/deck.gl-raster && pnpm vitest run tests/gpu-modules/cutline-bbox.test.ts
```

Expected: 5 passed.

- [ ] **Step 20: Add tests for shader module metadata (name, fs block, inject, uniformTypes)**

Add inside the `describe` block:

```ts
it("has the expected module name", () => {
  expect(CutlineBbox.name).toBe("cutlineBbox");
});

it("declares a vec4<f32> bbox uniform", () => {
  expect(CutlineBbox.uniformTypes.bbox).toBe("vec4<f32>");
});

it("declares the uniform block in fs", () => {
  expect(CutlineBbox.fs).toContain("cutlineBboxUniforms");
  expect(CutlineBbox.fs).toContain("vec4 bbox");
});

it("injects a discard into DECKGL_FILTER_COLOR", () => {
  const injected = CutlineBbox.inject["fs:DECKGL_FILTER_COLOR"];
  expect(injected).toContain("position_commonspace");
  expect(injected).toContain("discard");
});
```

- [ ] **Step 21: Run all the tests and verify they all pass**

Run:

```bash
cd packages/deck.gl-raster && pnpm vitest run tests/gpu-modules/cutline-bbox.test.ts
```

Expected: 9 passed, 0 failed.

- [ ] **Step 22: Run the full package test suite to confirm nothing regressed**

Run:

```bash
cd packages/deck.gl-raster && pnpm test
```

Expected: all tests pass (including the new `cutline-bbox.test.ts`).

- [ ] **Step 23: Commit**

```bash
git add packages/deck.gl-raster/src/gpu-modules/cutline-bbox.ts packages/deck.gl-raster/tests/gpu-modules/cutline-bbox.test.ts
git commit -m "$(cat <<'EOF'
feat: Add CutlineBbox shader module

Discards fragments outside a WGS84 axis-aligned bbox. Intended for
rendering rasters with a "map collar" (e.g. USGS historical topos) where
the valid data area is described as a lat/lng bbox but the raw pixels
include surrounding metadata. Mercator-only; caller must enforce
WebMercatorViewport.
EOF
)"
```

---

## Task 2: Export from gpu-modules barrel and verify build

**Files:**
- Modify: `packages/deck.gl-raster/src/gpu-modules/index.ts`

---

- [ ] **Step 1: Add the export to the gpu-modules barrel**

Open `packages/deck.gl-raster/src/gpu-modules/index.ts`. It currently looks like:

```ts
export {
  BlackIsZero,
  CMYKToRGB,
  cieLabToRGB,
  WhiteIsZero,
  YCbCrToRGB,
} from "./color";
export { Colormap } from "./colormap";
export type { CompositeBandsProps } from "./composite-bands.js";
export {
  buildCompositeBandsProps,
  CompositeBands,
} from "./composite-bands.js";
export { CreateTexture } from "./create-texture";
export { FilterNoDataVal } from "./filter-nodata";
export type { LinearRescaleProps } from "./linear-rescale.js";
export { LinearRescale } from "./linear-rescale.js";
export { MaskTexture } from "./mask-texture";
export type { RasterModule } from "./types";
```

Add two new lines, keeping alphabetical-ish grouping near the other cutline/filter modules:

```ts
export type { CutlineBboxProps } from "./cutline-bbox.js";
export { CutlineBbox } from "./cutline-bbox.js";
```

The final file should contain those two new lines in addition to the existing ones. Do not remove or reorder any other exports.

- [ ] **Step 2: Run typecheck on the whole monorepo**

From the repo root:

```bash
pnpm typecheck
```

Expected: the `@developmentseed/deck.gl-raster` package typechecks cleanly. Note: there may be pre-existing typecheck errors in other packages (e.g. `cog-layer.ts`, `cog-tile-matrix-set.ts`) that predate this change — ignore those. Verify that no new errors reference `cutline-bbox.ts`, `CutlineBbox`, or `CutlineBboxProps`.

- [ ] **Step 3: Run Biome check to catch formatting or lint issues**

From the repo root:

```bash
pnpm check
```

Expected: no new issues reported for `cutline-bbox.ts`, `cutline-bbox.test.ts`, or `gpu-modules/index.ts`. If issues appear, run:

```bash
pnpm check:fix
```

and inspect the resulting diff — apply only changes inside the three files touched by this plan.

- [ ] **Step 4: Build the package to confirm the new module compiles**

```bash
cd packages/deck.gl-raster && pnpm build
```

Expected: build completes without errors, and `packages/deck.gl-raster/dist/gpu-modules/cutline-bbox.js` + `cutline-bbox.d.ts` exist.

- [ ] **Step 5: Run the package test suite one more time after the export change**

```bash
cd packages/deck.gl-raster && pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/deck.gl-raster/src/gpu-modules/index.ts
git commit -m "$(cat <<'EOF'
feat: Export CutlineBbox from gpu-modules barrel
EOF
)"
```

---

## Task 3: Final sanity check

**No file changes. This is a gate before declaring the work done.**

---

- [ ] **Step 1: Confirm the spec's required behaviors are covered by tests**

Re-read [the spec](../specs/2026-04-14-cutline-bbox-shader-module-design.md#validation) and check off:

- [x] WGS84 → common space conversion via `lngLatToWorld` — Task 1 Step 2
- [x] `east <= west` throws — Task 1 Step 8
- [x] `north <= south` throws — Task 1 Step 12
- [x] Latitude limits (±85.051129°) throw — Task 1 Step 16
- [x] Shader module shape (name, uniformTypes, fs block, inject target) — Task 1 Step 20
- [x] Exported from barrel — Task 2 Step 1
- [x] Globe-support comment at injection site — Task 1 Step 4 (present in `inject["fs:DECKGL_FILTER_COLOR"]`)

If any box cannot be checked, return to the relevant task and add the missing coverage before proceeding.

- [ ] **Step 2: Confirm the branch log contains exactly the expected commits**

```bash
git log --oneline main..HEAD
```

Expected (top of output, newest first):

```
<hash> feat: Export CutlineBbox from gpu-modules barrel
<hash> feat: Add CutlineBbox shader module
<hash> docs: Spec for cutline-bbox shader module
```

If extra commits appear, investigate before merging.

- [ ] **Step 3: Stop and hand off**

Implementation is complete as defined by this plan. The user (Kyle) will separately add an `examples/usgs-topo` demo that wires `CutlineBbox` into a custom `renderTile` callback on `COGLayer` and visually verifies it against a real USGS COG. That visual verification is **not** part of this plan — report the branch as ready for example wiring and manual visual test.
