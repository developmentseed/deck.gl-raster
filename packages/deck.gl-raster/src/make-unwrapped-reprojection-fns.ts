import { nearestCopy, unwrapAlong } from "@developmentseed/proj";
import type { ReprojectionFns } from "@developmentseed/raster-reproject";

/**
 * How far to walk from the image's center toward each corner: just short of
 * it, because a corner can be a pole, where x is arbitrary.
 */
const INSIDE_CORNER = 1 - 1e-6;

/**
 * Wrap an image's reprojection functions so that the forward projection is
 * continuous across an output x axis that wraps around, such as Web
 * Mercator's, which repeats every world width.
 *
 * A projection returns x in one copy of the world, so where an image crosses
 * the wrap (the antimeridian), neighboring pixels land a whole period apart,
 * and no mesh can follow that jump. This unwraps the image's four corners, by
 * walking to each from the image's center with {@link unwrapAlong}, then moves
 * each projected point's x to the copy nearest the bilinear blend of the
 * corners at that point's pixel. The result is continuous, so the reprojector
 * meshes the image in one piece, like any other. Its x may run past one
 * period: the caller cuts the mesh there.
 *
 * Each point lands in the right copy as long as its x is within half a period
 * of the blend, which holds unless the image contains a pole. Only the forward
 * projection changes: the inverse still expects x in one copy, so the mesh
 * must be built with `_errorSpace: "output"`, which doesn't call it.
 *
 * @param fns The image's reprojection functions, with x in one copy.
 * @param options.width The image's width, in pixels.
 * @param options.height The image's height, in pixels.
 * @param options.period The period of the output's x axis, such as one world
 *   width.
 */
export function makeUnwrappedReprojectionFns(
  fns: ReprojectionFns,
  options: { width: number; height: number; period: number },
): ReprojectionFns {
  const { width, height, period } = options;
  const xAt = (px: number, py: number) =>
    fns.forwardReproject(...fns.forwardTransform(px, py))[0];

  // Each corner's x, unwrapped by walking to it from the center.
  const centerX = width / 2;
  const centerY = height / 2;
  const start = xAt(centerX, centerY);
  const cornerX = (px: number, py: number) =>
    unwrapAlong(
      (t) =>
        xAt(
          centerX + t * INSIDE_CORNER * (px - centerX),
          centerY + t * INSIDE_CORNER * (py - centerY),
        ),
      { start, period },
    );
  const topLeft = cornerX(0, 0);
  const topRight = cornerX(width, 0);
  const bottomLeft = cornerX(0, height);
  const bottomRight = cornerX(width, height);

  return {
    ...fns,
    forwardReproject: (x, y) => {
      const [px, py] = fns.inverseTransform(x, y);
      const s = px / width;
      const t = py / height;
      const blend =
        (1 - s) * (1 - t) * topLeft +
        s * (1 - t) * topRight +
        (1 - s) * t * bottomLeft +
        s * t * bottomRight;
      const [outX, outY] = fns.forwardReproject(x, y);
      return [nearestCopy(outX, blend, period), outY];
    },
  };
}
