import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/deck.gl-raster/examples/land-cover/",
  server: {
    port: 3000,
  },
});
