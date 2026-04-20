/**
 * Build the ZarrLayer `selection` for the anomaly array.
 * The only non-spatial dimension is valid_date — keep all of them (null)
 * so every date is fetched per tile and packed into a Texture2DArray.
 */
export function buildSelection(): Record<string, null> {
  return { valid_date: null };
}
