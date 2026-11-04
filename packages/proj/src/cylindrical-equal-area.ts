import proj4 from "proj4";
import type { ProjectionDefinition } from "./parse-wkt.js";

/**
 * Register proj4's Cylindrical Equal Area projection under the method names
 * that wkt-parser gives it, "Lambert Cylindrical Equal Area" (WKT2 and
 * PROJJSON) and "Cylindrical_Equal_Area" (WKT1), reading its standard parallel
 * from `lat1`, where wkt-parser puts it.
 *
 * A workaround until proj4js and wkt-parser handle both. See #791.
 */
export function registerCylindricalEqualArea(): void {
  const cea = proj4.Proj.projections.get("cea");
  if (!cea) {
    throw new Error("proj4 has no Cylindrical Equal Area projection");
  }
  proj4.Proj.projections.add(
    {
      ...cea,
      names: ["Lambert_Cylindrical_Equal_Area", "Cylindrical_Equal_Area"],
      init(this: ProjectionDefinition) {
        this.lat_ts ??= this.lat1 ?? 0;
        cea.init.call(this);
      },
    },
    0,
  );
}
