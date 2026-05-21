import proj4 from "proj4";
// @ts-expect-error — proj4/projs has no published types
import includedProjections from "proj4/projs";

// Re-register proj4's built-in projection classes (utm, lcc, tmerc, …).
//
// proj4/lib/index.js calls includedProjections(proj4) at module init, but
// CDN bundlers (esm.sh, jsDelivr /+esm, …) can drop that side-effect call
// when re-bundling, leaving only merc/longlat registered and breaking any
// non-trivial COG. See esm.sh#754. Calling it from our own entry keeps the
// registration in code the bundler must preserve.
//
// This file is the only intentional side-effect in the package and is the
// sole entry listed in `"sideEffects"` in package.json.
(includedProjections as (p: typeof proj4) => void)(proj4);
