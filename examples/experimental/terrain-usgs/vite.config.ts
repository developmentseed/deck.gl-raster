import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Deliberately omits the `experimental/` segment that this example's
  // directory has. The deployed URL is what users bookmark, so it must not
  // change when the example graduates out of `examples/experimental/` — the
  // move then becomes a pure `git mv` with no broken links. The docs workflow
  // takes the same view: it uses `basename`, so the parent directory never
  // reaches the published path.
  base: "/deck.gl-raster/examples/terrain-usgs/",
  worker: { format: "es" },
  server: {
    port: 3000,
  },
});
