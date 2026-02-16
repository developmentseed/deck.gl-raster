import type { DecodedPixels } from "../decode/api.js";

let wasmInitialized = false;

async function getLerc() {
  // This import is cached by the module loader
  const lerc = await import("lerc");

  if (!wasmInitialized) {
    await lerc.load();
    wasmInitialized = true;
  }

  return lerc;
}

export async function decode(bytes: ArrayBuffer): Promise<DecodedPixels> {
  const lerc = await getLerc();
  const result = lerc.decode(bytes);
  return { layout: "band-separate", bands: result.pixels };
}
