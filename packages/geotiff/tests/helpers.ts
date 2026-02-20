import { resolve } from "node:path";
import { SourceFile } from "@chunkd/source-file";
import { GeoTIFF } from "../src/geotiff.js";

// ── Fixture helpers ─────────────────────────────────────────────────────

const FIXTURES_DIR = resolve(
  import.meta.dirname,
  "../../../fixtures/geotiff-test-data",
);

/**
 * Resolve a test fixture path.
 * @param name - filename without extension (e.g. "uint8_rgb_deflate_block64_cog")
 * @param variant - "rasterio" (default) or a real_data subdirectory name
 */
export function fixturePath(name: string, variant: string): string {
  if (variant === "rasterio") {
    return resolve(FIXTURES_DIR, "rasterio_generated/fixtures", `${name}.tif`);
  }
  return resolve(FIXTURES_DIR, "real_data", variant, `${name}.tif`);
}

/** Open a GeoTIFF test fixture by name. */
export async function loadGeoTIFF(
  name: string,
  variant: string,
): Promise<GeoTIFF> {
  const path = fixturePath(name, variant);
  const source = new SourceFile(path);
  return GeoTIFF.open(source);
}
