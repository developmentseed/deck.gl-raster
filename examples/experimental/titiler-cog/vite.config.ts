import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Published at the same flat URL as non-experimental examples, so promoting
  // this example out of `examples/experimental/` doesn't break links.
  base: "/deck.gl-raster/examples/titiler-cog/",
  worker: { format: "es" },
  server: {
    port: 3000,
  },
});
