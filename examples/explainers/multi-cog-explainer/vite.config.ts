import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/deck.gl-raster/examples/multi-cog-explainer/",
  server: {
    port: 3000,
  },
});
