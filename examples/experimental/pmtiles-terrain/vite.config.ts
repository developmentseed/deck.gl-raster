import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Published at the same flat URL as non-experimental examples, so promoting
  // this example out of `examples/experimental/` doesn't break links. The docs
  // workflow takes the same view: it uses the directory's basename.
  base: "/deck.gl-raster/examples/pmtiles-terrain/",
  server: {
    port: 3000,
  },
});
