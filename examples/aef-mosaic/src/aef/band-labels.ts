import * as zarr from "zarrita";
import { NUM_BANDS } from "./constants.js";

/**
 * Open and fully read the `band` coordinate array from the AEF root group.
 * The `band` array is a length-64 vlen-utf8 string array; the resolved
 * value is the list of band labels in order.
 *
 * @param root - An already-opened AEF root group.
 * @returns Promise resolving to 64 band labels.
 */
export async function fetchBandLabels(
  root: zarr.Group<zarr.Readable>,
): Promise<string[]> {
  const bandArr = await zarr.open.v3(root.resolve("band"), { kind: "array" });
  const chunk = await zarr.get(bandArr as zarr.Array<"string", zarr.Readable>);
  const labels = Array.from(chunk.data as Array<string>);
  if (labels.length !== NUM_BANDS) {
    throw new Error(`Expected ${NUM_BANDS} band labels, got ${labels.length}`);
  }
  return labels;
}
