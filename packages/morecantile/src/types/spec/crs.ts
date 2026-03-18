/* This file was automatically generated from OGC TMS 2.0 JSON Schema. */
/* DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file */
/* and run `pnpm run generate-types` to regenerate.                     */

import type { ProjJSON } from "./projJSON.js";

export type CRS =
  | string
  | (
      | {
          /**
           * Reference to one coordinate reference system (CRS)
           */
          uri: string;
          [k: string]: unknown;
        }
      | {
          wkt: ProjJSON;
          [k: string]: unknown;
        }
      | {
          /**
           * A reference system data structure as defined in the MD_ReferenceSystem of the ISO 19115
           */
          referenceSystem: {
            [k: string]: unknown;
          };
          [k: string]: unknown;
        }
    );
