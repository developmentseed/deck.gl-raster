/// <reference path="./parse-wkt.ts" />
/// <reference path="./projjson.ts" />

declare module "wkt-parser" {
  import type { ProjectionDefinition } from "./parse-wkt.js";
  import type { ProjJson } from "./projjson.js";

  export default function wktParser(
    input: string | ProjJson,
  ): ProjectionDefinition;
}
