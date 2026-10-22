import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * deck.gl-raster's built modules. The explainer calls a few functions the
 * package doesn't export (`makeUnwrappedReprojectionFns`, `clipMeshToWorld`
 * and `rescaleEPSG3857ToCommonSpace`), so that it runs exactly the code
 * `RasterLayer` runs. Its export map blocks deep imports, so this private
 * specifier maps straight to `dist/`, for this explainer only: the package's
 * exports don't change. `tsconfig.json` has the matching `paths` entry.
 */
const DECK_GL_RASTER_DIST = fileURLToPath(
  new URL("../../../packages/deck.gl-raster/dist/", import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  base: "/deck.gl-raster/examples/antimeridian-explainer/",
  worker: { format: "es" },
  resolve: {
    alias: [
      {
        // Biome adds `.js` to the specifier, as to every import; accept both.
        find: /^@developmentseed\/deck\.gl-raster\/internal\/(.*?)(?:\.js)?$/,
        replacement: `${DECK_GL_RASTER_DIST}$1.js`,
      },
    ],
  },
  server: {
    port: 3000,
  },
});
