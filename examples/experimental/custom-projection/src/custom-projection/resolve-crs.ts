import { projectionEngine } from "@math.gl/geospatial/projection";
import type {
  CRSDescriptor,
  TypeScriptCRSInput,
} from "@math.gl/geospatial/projection/core";

/** Descriptors, or their pending loads, keyed by CRS definition. */
const resolved = new Map<string, CRSDescriptor | Promise<CRSDescriptor>>();

/**
 * Resolve a CRS definition with math.gl's projection engine, as upstream
 * deck.gl v10 does for `_CustomProjectionView`.
 *
 * Once a definition has loaded, this returns its descriptor synchronously.
 * Equal definitions share one load. A failed load is forgotten, so a later
 * call retries it.
 */
export function resolveCRS(
  crs: TypeScriptCRSInput,
): CRSDescriptor | Promise<CRSDescriptor> {
  const key = typeof crs === "string" ? crs : JSON.stringify(crs);
  const existing = resolved.get(key);
  if (existing) {
    return existing;
  }
  const pending = projectionEngine.getCRS(crs).then(
    (descriptor) => {
      resolved.set(key, descriptor);
      return descriptor;
    },
    (error: unknown) => {
      if (resolved.get(key) === pending) {
        resolved.delete(key);
      }
      throw error;
    },
  );
  resolved.set(key, pending);
  return pending;
}
