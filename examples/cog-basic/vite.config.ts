import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/deck.gl-raster/examples/cog-basic/",
  server: {
    port: 3000,
  },
});
