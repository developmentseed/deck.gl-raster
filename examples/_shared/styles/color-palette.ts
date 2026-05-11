import { rgba, shade, tint } from "polished";

/** Curry the polished `rgba` function so the alpha can be bound first. */
const _rgba = (alpha: number) => (color: string) => rgba(color, alpha);

const colorPaletteSettings = [
  { code: "50", colorFn: tint(0.96) },
  { code: "50a", colorFn: _rgba(0.04) },
  { code: "100", colorFn: tint(0.92) },
  { code: "100a", colorFn: _rgba(0.08) },
  { code: "200", colorFn: tint(0.84) },
  { code: "200a", colorFn: _rgba(0.16) },
  { code: "300", colorFn: tint(0.68) },
  { code: "300a", colorFn: _rgba(0.32) },
  { code: "400", colorFn: tint(0.36) },
  { code: "400a", colorFn: _rgba(0.64) },
  { code: "500", colorFn: (v: string) => v },
  { code: "600", colorFn: shade(0.16) },
  { code: "700", colorFn: shade(0.32) },
  { code: "800", colorFn: shade(0.48) },
  { code: "900", colorFn: shade(0.64) },
];

/**
 * Build a Chakra color-token map from a single base color.
 *
 * Returns shades `50`–`900` (lightened below `500`, darkened above) plus
 * `…a` variants with an alpha channel — e.g. `{ "500": { value: base }, … }`.
 *
 * @param baseColor Base color used as the `500` shade.
 */
export function createColorPalette(baseColor: string) {
  return colorPaletteSettings.reduce<Record<string, { value: string }>>(
    (acc, c) => {
      acc[c.code] = { value: c.colorFn(baseColor) };
      return acc;
    },
    {},
  );
}
