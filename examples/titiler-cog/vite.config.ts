import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/deck.gl-raster/examples/titiler-cog/",
  worker: { format: "es" },
  server: {
    port: 3000,
  },
});
