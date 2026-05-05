import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/deck.gl-raster/examples/hillshade-swisstopo/",
  worker: { format: "es" },
  server: {
    port: 3001,
  },
});
