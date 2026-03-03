import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? "/deck.gl-raster/examples/aef-embeddings/",
  server: {
    port: 3001,
  },
});
