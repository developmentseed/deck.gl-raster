import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GeoProjAttrsSchema, MultiscalesAttrsSchema, SpatialAttrsSchema } from "../src/schemas.js";

function readExample(submodule: string, filename: string): unknown {
  const path = resolve(import.meta.dirname, "..", submodule, "examples", filename);
  return JSON.parse(readFileSync(path, "utf8"));
}

function attrs(example: unknown): unknown {
  return (example as { attributes: unknown }).attributes;
}

// ---------------------------------------------------------------------------
// spatial convention examples
// ---------------------------------------------------------------------------

describe("SpatialAttrsSchema", () => {
  it("passes spatial/examples/proj.json (top-level transform)", () => {
    const result = SpatialAttrsSchema.safeParse(attrs(readExample("spatial", "proj.json")));
    expect(result.success).toBe(true);
  });

  it("passes spatial/examples/multiscales.json (per-level transform)", () => {
    const result = SpatialAttrsSchema.safeParse(attrs(readExample("spatial", "multiscales.json")));
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// geo-proj convention examples
// ---------------------------------------------------------------------------

describe("GeoProjAttrsSchema", () => {
  it("passes geo-proj/examples/epsg26711.json (proj:code)", () => {
    const result = GeoProjAttrsSchema.safeParse(attrs(readExample("geo-proj", "epsg26711.json")));
    expect(result.success).toBe(true);
  });

  it("passes geo-proj/examples/epsg3587.json (proj:code)", () => {
    const result = GeoProjAttrsSchema.safeParse(attrs(readExample("geo-proj", "epsg3587.json")));
    expect(result.success).toBe(true);
  });

  it("passes geo-proj/examples/wkt2.json (proj:wkt2)", () => {
    const result = GeoProjAttrsSchema.safeParse(attrs(readExample("geo-proj", "wkt2.json")));
    expect(result.success).toBe(true);
  });

  it("passes geo-proj/examples/multiscales.json (proj:code + spatial + multiscales)", () => {
    const result = GeoProjAttrsSchema.safeParse(attrs(readExample("geo-proj", "multiscales.json")));
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// multiscales convention examples
// ---------------------------------------------------------------------------

describe("MultiscalesAttrsSchema", () => {
  for (const filename of [
    "array-based-pyramid.json",
    "custom-pyramid-levels.json",
    "dem-multiresolution.json",
    "geospatial-pyramid.json",
    "power-of-2-pyramid.json",
    "sentinel-2-multiresolution.json",
  ]) {
    it(`passes multiscales/examples/${filename}`, () => {
      const result = MultiscalesAttrsSchema.safeParse(
        attrs(readExample("multiscales", filename)),
      );
      expect(result.success).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// SpatialAttrsSchema on multiscales examples that include spatial:
// ---------------------------------------------------------------------------

describe("SpatialAttrsSchema on multiscales examples", () => {
  it("passes dem-multiresolution.json (top-level + per-level transform)", () => {
    const result = SpatialAttrsSchema.safeParse(
      attrs(readExample("multiscales", "dem-multiresolution.json")),
    );
    expect(result.success).toBe(true);
  });

  it("passes geospatial-pyramid.json (top-level + per-level transform)", () => {
    const result = SpatialAttrsSchema.safeParse(
      attrs(readExample("multiscales", "geospatial-pyramid.json")),
    );
    expect(result.success).toBe(true);
  });

  it("passes sentinel-2-multiresolution.json (per-level transform only)", () => {
    const result = SpatialAttrsSchema.safeParse(
      attrs(readExample("multiscales", "sentinel-2-multiresolution.json")),
    );
    expect(result.success).toBe(true);
  });

  it("fails when transform is missing everywhere", () => {
    const result = SpatialAttrsSchema.safeParse({
      "spatial:dimensions": ["Y", "X"],
      multiscales: {
        layout: [{ asset: "0" }, { asset: "1" }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("fails when only some layout items have spatial:transform", () => {
    const result = SpatialAttrsSchema.safeParse({
      "spatial:dimensions": ["Y", "X"],
      multiscales: {
        layout: [
          { asset: "0", "spatial:transform": [1, 0, 0, 0, -1, 0] },
          { asset: "1" }, // missing
        ],
      },
    });
    expect(result.success).toBe(false);
  });
});
