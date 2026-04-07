import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/deck.gl-raster/examples/zarr-sentinel2-tci/",
  worker: { format: "es" },
  server: {
    port: 3000,
  },
});
