import { describe, expect, it } from "vitest";
import * as reader from "../src/index.js";

describe("package", () => {
  it("builds and exports a module", () => {
    expect(reader).toBeDefined();
  });
});
