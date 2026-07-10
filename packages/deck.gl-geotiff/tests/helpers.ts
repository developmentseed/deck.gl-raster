// This file is duplicated from packages/geotiff/tests/helpers.ts. We can't
// share it across packages because composite project references require
// every imported file to have an emitted .d.ts in the referenced project's
// outDir, and tsconfig.build.json excludes tests/ from emission.
import { resolve } from "node:path";
import { SourceFile } from "@chunkd/source-file";
import { GeoTIFF } from "@developmentseed/geotiff";

const FIXTURES_DIR = resolve(
  import.meta.dirname,
  "../../../fixtures/geotiff-test-data",
);

/**
 * Resolve a test fixture path.
 * @param name - filename without extension (e.g. "uint8_rgb_deflate_block64_cog")
 * @param variant - "rasterio" (default) or a real_data subdirectory name
 */
export function fixturePath(
  name: string,
  variant: string,
  suffix: string = ".tif",
): string {
  if (variant === "rasterio") {
    return resolve(
      FIXTURES_DIR,
      "rasterio_generated/fixtures",
      `${name}${suffix}`,
    );
  }
  return resolve(FIXTURES_DIR, "real_data", variant, `${name}${suffix}`);
}

/** Open a GeoTIFF test fixture by name. */
export async function loadGeoTIFF(
  name: string,
  variant: string,
): Promise<GeoTIFF> {
  const path = fixturePath(name, variant);
  const source = new SourceFile(path);
  return GeoTIFF.open({ dataSource: source, headerSource: source });
}
