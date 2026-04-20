import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/deck.gl-raster/examples/temp-anomaly/",
  worker: { format: "es" },
  server: {
    port: 3001,
    // Proxy local zarr server so the browser avoids CORS.
    // Run: python -m http.server 8080
    // from the weather-extremes/data/ directory.
    proxy: {
      "/anomaly.zarr": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
