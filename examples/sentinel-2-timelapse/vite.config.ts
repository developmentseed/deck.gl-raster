import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/deck.gl-raster/examples/sentinel-2-timelapse/",
  worker: { format: "es" },
  server: {
    port: 3002,
  },
});
