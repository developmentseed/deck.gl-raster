/**
 * What it costs to keep a mesh's error at 0.125 px on screen when zooming
 * past the tile's own level: each extra zoom level halves the tolerance in
 * output pixels. Compares refining the existing mesh in place (calling
 * `run()` again) with building it from scratch at that tolerance. See
 * README.md.
 */

import { performance } from "node:perf_hooks";
import {
  degenerateCount,
  environment,
  fmt,
  loadReprojector,
  makeImage,
  reprojectionFns,
  withoutWarnings,
} from "./common.mjs";

const { RasterReprojector } = await loadReprojector();

const CASES = [
  {
    name: "UTM 33N, 10 m, 5 km (a Sentinel-2 tile at full resolution)",
    image: { crs: "EPSG:32633", x0: 300000, y0: 5000000, sx: 10, sy: 10 },
  },
  {
    name: "EPSG:4326, 0.25 deg, 128 deg from 80N to 48S (a coarse global tile)",
    image: { crs: "EPSG:4326", x0: -64, y0: 80, sx: 0.25, sy: 0.25 },
  },
];

/** Refinement steps allowed per tolerance before giving up. */
const MAX_ITERATIONS = 1_000_000;

function newReprojector(image) {
  return new RasterReprojector(
    reprojectionFns(image),
    image.width + 1,
    image.height + 1,
    { _errorSpace: "output" },
  );
}

/** Milliseconds `fn` takes, and whether it warned (did not converge). */
function timeRun(fn) {
  const [ms, warned] = withoutWarnings(() => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  });
  return { ms, capped: warned };
}

/** Latitude bands and edge distance of the last 100,000 vertices added. */
function describeRunaway(r, image) {
  const count = r.uvs.length / 2;
  const first = Math.max(0, count - 100_000);
  const bands = new Map();
  let nearEdge = 0;
  for (let i = first; i < count; i++) {
    const u = r.uvs[2 * i];
    const v = r.uvs[2 * i + 1];
    const lat = image.y0 - v * image.height * image.sy;
    const band = Math.floor(lat / 5) * 5;
    bands.set(band, (bands.get(band) ?? 0) + 1);
    if (u < 1e-3 || u > 1 - 1e-3) {
      nearEdge++;
    }
  }
  const top = [...bands.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([band, n]) => `${band} to ${band + 5} deg: ${n}`);
  console.log(
    `\nLast ${count - first} vertices added, by latitude band: ${top.join(", ")}. Within 0.001 of the left or right edge (in u): ${nearEdge}.`,
  );
}

console.log(`# Refining a mesh past its tile's level\n\n${environment()}\n`);
console.log(
  `Each row halves the tolerance (one extra zoom level). "cap" = stopped after ${MAX_ITERATIONS.toLocaleString("en-US")} refinement steps without reaching it.\n`,
);
for (const { name, image: spec } of CASES) {
  const image = makeImage(spec);
  console.log(`## ${name}\n`);
  console.log(
    "| Extra levels | Tolerance (output px) | Triangles | Max error reached | Refine in place (ms) | From scratch (ms) | Folded tris | Zero-area tris | Duplicate vertices |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|");
  const inPlace = newReprojector(image);
  for (let level = 0; level <= 6; level++) {
    const tolerance = 0.125 / 2 ** level;
    const step = timeRun(() =>
      inPlace.run(tolerance, { maxIterations: MAX_ITERATIONS }),
    );
    const scratch = timeRun(() =>
      newReprojector(image).run(tolerance, { maxIterations: MAX_ITERATIONS }),
    );
    const { zeroAreaTriangles, invertedTriangles, duplicateVertices } =
      degenerateCount(inPlace);
    console.log(
      `| +${level} | ${tolerance} | ${inPlace.triangles.length / 3}${step.capped ? " (cap)" : ""} | ${fmt(inPlace.getMaxError(), 4)} | ${fmt(step.ms)} | ${fmt(scratch.ms)} | ${invertedTriangles} | ${zeroAreaTriangles} | ${duplicateVertices} |`,
    );
    if (step.capped) {
      describeRunaway(inPlace, image);
      break;
    }
  }
  console.log("");
}
