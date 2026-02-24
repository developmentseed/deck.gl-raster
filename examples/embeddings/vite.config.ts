import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? "/deck.gl-raster/examples/embeddings/",
  server: {
    port: 3001,
  },
});
