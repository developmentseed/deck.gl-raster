import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/deck.gl-raster/examples/land-cover/",
  server: {
    port: 3000,
  },
});
