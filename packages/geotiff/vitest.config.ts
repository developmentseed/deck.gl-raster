import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.config.js";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      setupFiles: ["./tests/polyfills.ts"],
    },
  }),
);
