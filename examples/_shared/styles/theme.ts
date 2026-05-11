import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        // deck.gl-raster brand blue. A minimal scale — only the shades the
        // shared components reference today. Expand as needed.
        brand: {
          500: { value: "#1e7bc6" },
          600: { value: "#1967a6" },
          700: { value: "#145487" },
        },
      },
    },
  },
});

/** Chakra system for the shared example theme. Pass to `<ChakraProvider value={system}>`. */
export const system = createSystem(defaultConfig, config);
