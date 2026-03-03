import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  assetsInclude: ["**/*.csv.gz"],
  base: "/deck.gl-raster/examples/land-cover/",
  worker: { format: "es" },
  server: {
    port: 3000,
  },
});
