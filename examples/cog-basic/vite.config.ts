import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/deck.gl-raster/",
  server: {
    port: 3000,
  },
});
