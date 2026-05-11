import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";
import { createColorPalette } from "./color-palette.js";

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        // deck.gl-raster brand blue. Tweak freely; semantic-token wiring for
        // `colorPalette="brand"` is a possible follow-up.
        brand: createColorPalette("#1e7bc6"),
      },
    },
  },
});

/** Chakra system for the shared example theme. Pass to `<ChakraProvider value={system}>`. */
export const system = createSystem(defaultConfig, config);
