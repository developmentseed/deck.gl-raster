/**
 * Variants of `RasterReprojector` on the same 512 px images, meshed into
 * deck.gl common space as `RasterTileLayer` does (output-mode error):
 *
 * - main: `delatin.ts` at the studied commit.
 * - main + cache: main with `forwardReproject` behind a cache keyed by the
 *   coordinate string, as OpenLayers' `Triangulation` caches its transforms.
 * - #759: the edge-midpoint memo of PR #759.
 * - map-space: main with the Delaunay test run on output positions.
 * - #759 + map-space: both.
 *
 * Reports triangles, proj4 calls per triangle, median build time, the mesh's
 * true max error, degenerate triangles, and which meshes are bit-identical.
 * See README.md.
 */

import { performance } from "node:perf_hooks";
import {
  degenerateCount,
  environment,
  fmt,
  loadReprojector,
  MAX_MERCATOR_LAT,
  makeImage,
  median,
  mercatorToCommon,
  meshError,
  outputPixelSize,
  PR_759_COMMIT,
  reprojectionFns,
  reprojectorTriangles,
  withoutWarnings,
} from "./common.mjs";

const VARIANTS = [
  { name: "main", module: await loadReprojector() },
  { name: "main + cache", module: await loadReprojector(), cache: true },
  { name: "#759", module: await loadReprojector({ commit: PR_759_COMMIT }) },
  { name: "map-space", module: await loadReprojector({ mapSpace: true }) },
  {
    name: "#759 + map-space",
    module: await loadReprojector({ commit: PR_759_COMMIT, mapSpace: true }),
  },
];

const CASES = [
  {
    name: "UTM 33N, 160 m",
    image: { crs: "EPSG:32633", x0: 300000, y0: 5000000, sx: 160, sy: 160 },
  },
  {
    name: "UTM 33N, 1280 m",
    image: { crs: "EPSG:32633", x0: 166000, y0: 5300000, sx: 1280, sy: 1280 },
  },
  {
    name: "EPSG:3413, 2 km",
    image: { crs: "EPSG:3413", x0: -1200000, y0: -2000000, sx: 2000, sy: 2000 },
  },
  {
    name: "EPSG:4326, 5 deg (40-45N)",
    image: { crs: "EPSG:4326", x0: 10, y0: 45, sx: 5 / 512, sy: 5 / 512 },
  },
  {
    name: "EPSG:4326, 90x80 deg (0-80N)",
    image: { crs: "EPSG:4326", x0: 0, y0: 80, sx: 90 / 512, sy: 80 / 512 },
  },
  {
    name: "EPSG:4326, 90x40 deg (40-80N)",
    image: { crs: "EPSG:4326", x0: 0, y0: 80, sx: 90 / 512, sy: 40 / 512 },
  },
  {
    name: "EPSG:4326, 45 deg (45-90N, clamped; #759's tile)",
    image: { crs: "EPSG:4326", x0: 0, y0: 90, sx: 45 / 512, sy: 45 / 512 },
    clamp: true,
  },
  {
    name: "EPSG:4326, 0.25 deg, 128 deg (80N-48S)",
    image: { crs: "EPSG:4326", x0: -64, y0: 80, sx: 0.25, sy: 0.25 },
  },
  {
    name: "EPSG:4326, 90x90 deg (45S-45N, #713)",
    image: { crs: "EPSG:4326", x0: 0, y0: 45, sx: 90 / 512, sy: 90 / 512 },
  },
];

const REPS = 11;

/** `forwardReproject` behind a cache keyed by the coordinate string. */
function withCoordinateCache(fns) {
  const cache = new Map();
  return {
    ...fns,
    forwardReproject: (x, y) => {
      const key = `${x}/${y}`;
      let p = cache.get(key);
      if (p === undefined) {
        p = fns.forwardReproject(x, y);
        cache.set(key, p);
      }
      return p;
    },
  };
}

/** The seed for an image: clamped to Web Mercator's latitudes if asked. */
function seedFor(variant, image, clamp) {
  if (!clamp || image.y0 <= MAX_MERCATOR_LAT) {
    return undefined;
  }
  const vMin = (image.y0 - MAX_MERCATOR_LAT) / (image.height * image.sy);
  return variant.module.triangulateRectangle(0, vMin, 1, 1);
}

function build(variant, image, clamp, tolerance, counter) {
  let fns = reprojectionFns(image, { space: "common", counter });
  if (variant.cache) {
    fns = withCoordinateCache(fns);
  }
  const [r, capped] = withoutWarnings(() => {
    const reprojector = new variant.module.RasterReprojector(
      fns,
      image.width + 1,
      image.height + 1,
      {
        initialTriangulation: seedFor(variant, image, clamp),
        _errorSpace: "output",
      },
    );
    reprojector.run(tolerance);
    return reprojector;
  });
  return { r, capped };
}

function sameMesh(a, b) {
  const same = (x, y) =>
    x.length === y.length && x.every((value, i) => Object.is(value, y[i]));
  return (
    same(a.triangles, b.triangles) &&
    same(a.uvs, b.uvs) &&
    same(a.exactOutputPositions, b.exactOutputPositions)
  );
}

console.log(`# RasterReprojector variants\n\n${environment()}\n`);
console.log(
  `Median of ${REPS} interleaved runs. "Max error" is the true error inside the drawn triangles, in output px. "Folded" counts inverted triangles.\n`,
);
console.log(
  "| Image | Tolerance | Variant | Triangles | proj4 calls / tri | ms | vs main | Max error | Folded | Zero-area tris | Duplicate vertices | Mesh |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const { name, image: spec, clamp } of CASES) {
  const image = makeImage(spec);
  const map = (px, py) =>
    mercatorToCommon(image.toMercator.forward(image.pixelToCrs(px, py)));
  const exactUV = (u, v) => map(u * image.width, v * image.height);
  for (const tolerance of [0.5, 0.125]) {
    // One untimed run per variant for counts, meshes and errors.
    const runs = VARIANTS.map((variant) => {
      const counter = { n: 0 };
      const { r, capped } = build(variant, image, clamp, tolerance, counter);
      return { variant, r, capped, calls: counter.n, times: [] };
    });
    for (let i = 0; i < REPS; i++) {
      for (const run of runs) {
        const t0 = performance.now();
        build(run.variant, image, clamp, tolerance, { n: 0 });
        run.times.push(performance.now() - t0);
      }
    }
    const vMin = clamp
      ? (image.y0 - MAX_MERCATOR_LAT) / (image.height * image.sy)
      : 0;
    const unit = outputPixelSize(
      map,
      image.width / 2,
      ((vMin + 1) / 2) * image.height,
    );
    const mainMs = median(runs[0].times);
    for (const run of runs) {
      const tris = run.r.triangles.length / 3;
      const ms = median(run.times);
      const error = meshError(reprojectorTriangles(run.r), exactUV, unit);
      const { duplicateVertices } = degenerateCount(run.r);
      const twin =
        run.variant.name === "main + cache" || run.variant.name === "#759"
          ? runs[0]
          : run.variant.name === "#759 + map-space"
            ? runs[3]
            : null;
      const identity = twin
        ? sameMesh(run.r, twin.r)
          ? `same as ${twin.variant.name}`
          : `differs from ${twin.variant.name}`
        : "";
      console.log(
        `| ${name} | ${tolerance} | ${run.variant.name} | ${tris}${run.capped ? " (cap)" : ""} | ${fmt(run.calls / tris, 1)} | ${fmt(ms)} | ${fmt(mainMs / ms)}x | ${fmt(error.max, 3)} | ${error.inverted} | ${error.zeroArea} | ${duplicateVertices} | ${identity} |`,
      );
    }
  }
}
