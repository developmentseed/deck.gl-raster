import type { RasterArray } from "@developmentseed/geotiff";
import type { Device } from "@luma.gl/core";
import type { ImageId } from "../animation/frame.js";
import type { BandId } from "../scene/constants.js";
import { BAND_IDS } from "../scene/constants.js";
import { insetRect } from "../scene/geometry.js";
import type { SceneData } from "../scene/load.js";
import type { CompositeInputs } from "./composite-layer.js";
import type { Assets } from "./frame-to-layers.js";
import { BAND_RANGES, cropCanvas, grayscaleCanvas } from "./images.js";
import { createBandTexture } from "./textures.js";

/**
 * Make everything frames draw from: grayscale canvases of the band images,
 * and GPU textures for the two composites.
 */
export function buildAssets(device: Device, scene: SceneData): Assets {
  const images = {} as Record<ImageId, HTMLCanvasElement>;
  for (const band of BAND_IDS) {
    const range = BAND_RANGES[band];
    images[`${band}-overview`] = grayscaleCanvas(scene.overview[band], range);
    images[`${band}-inset`] = cropCanvas(
      scene.stitched[band],
      insetRect(band, scene.tile),
      range,
    );
  }
  images["b04-tile"] = grayscaleCanvas(
    scene.fetched.b04[0]!.array,
    BAND_RANGES.b04,
  );
  images["b11-tile"] = grayscaleCanvas(
    scene.fetched.b11[0]!.array,
    BAND_RANGES.b11,
  );
  scene.fetched.b01.forEach((tile, i) => {
    images[`b01-piece-${i as 0 | 1 | 2 | 3}`] = grayscaleCanvas(
      tile.array,
      BAND_RANGES.b01,
    );
  });

  const textured = (
    arrays: Record<BandId, RasterArray>,
    uvTransform: (
      band: BandId,
    ) => CompositeInputs["bands"][BandId]["uvTransform"],
  ): CompositeInputs => ({
    bands: {
      b04: {
        texture: createBandTexture(device, arrays.b04),
        uvTransform: uvTransform("b04"),
      },
      b11: {
        texture: createBandTexture(device, arrays.b11),
        uvTransform: uvTransform("b11"),
      },
      b01: {
        texture: createBandTexture(device, arrays.b01),
        uvTransform: uvTransform("b01"),
      },
    },
    size: [arrays.b04.width, arrays.b04.height],
  });

  return {
    images,
    composites: {
      // Each coarsest overview covers the whole scene: no band is offset.
      overview: textured(scene.overview, () => [0, 0, 1, 1]),
      // The story tile, through each band's real UV transform.
      tile: textured(
        scene.stitched,
        (band) => scene.tile.bands[band].uvTransform,
      ),
    },
  };
}
