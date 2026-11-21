/**
 * OpenLayers' reprojection triangulation against deck.gl-raster's
 * `RasterReprojector`, on the same 512 px source images and the same proj4
 * functions. See README.md.
 *
 * Experiment A, "same job": both mesh the same source image, mapped to
 * EPSG:3857, at the same tolerance in output pixels (one source pixel's size
 * on the map at the image centre, the unit of our output-mode error).
 * OpenLayers' `Triangulation` runs with its roles swapped (its "target" is our
 * source CRS) so that it meshes the same rectangle in the same direction.
 *
 * Experiment B, "as each library runs": OpenLayers meshes every 256 px
 * EPSG:3857 target tile that overlaps the image, at the zoom where a screen
 * pixel is about one source pixel, with its own threshold rule (threshold x
 * ideal source resolution). We mesh the source image once. Errors are in
 * screen pixels at that zoom.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import {
  environment,
  fmt,
  HALF_WORLD,
  Locator,
  loadReprojector,
  makeImage,
  median,
  meshError,
  OPENLAYERS_COMMIT,
  outputPixelSize,
  proj4,
  reprojectionFns,
  reprojectorTriangles,
  summarize,
  withoutWarnings,
} from "./common.mjs";

const OPENLAYERS_DIR = process.env.OPENLAYERS_DIR;
if (!OPENLAYERS_DIR) {
  throw new Error(
    "Set OPENLAYERS_DIR to an OpenLayers checkout (see README.md).",
  );
}
const olHead = execFileSync(
  "git",
  ["-C", OPENLAYERS_DIR, "rev-parse", "HEAD"],
  {
    encoding: "utf8",
  },
).trim();
if (olHead !== OPENLAYERS_COMMIT) {
  console.warn(
    `OpenLayers is at ${olHead}; the report measured ${OPENLAYERS_COMMIT}.`,
  );
}
const ol = (path) =>
  import(pathToFileURL(join(OPENLAYERS_DIR, "src/ol", path)).href);
const { default: Triangulation } = await ol("reproj/Triangulation.js");
const { addCoordinateTransforms, get: getProjection } = await ol("proj.js");
const { register } = await ol("proj/proj4.js");
const { calculateSourceExtentResolution } = await ol("reproj.js");

register(proj4);
const { RasterReprojector } = await loadReprojector();

const MERCATOR_EXTENT = [-HALF_WORLD, -HALF_WORLD, HALF_WORLD, HALF_WORLD];

const CASES = [
  {
    name: "UTM 33N, 10 m (5 km)",
    image: { crs: "EPSG:32633", x0: 300000, y0: 5000000, sx: 10, sy: 10 },
  },
  {
    name: "UTM 33N, 160 m (82 km)",
    image: { crs: "EPSG:32633", x0: 300000, y0: 5000000, sx: 160, sy: 160 },
  },
  {
    name: "UTM 33N, 1280 m (655 km)",
    image: { crs: "EPSG:32633", x0: 166000, y0: 5300000, sx: 1280, sy: 1280 },
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
    name: "EPSG:3413, 2 km (about 64-72N)",
    image: { crs: "EPSG:3413", x0: -1200000, y0: -2000000, sx: 2000, sy: 2000 },
  },
  {
    name: "EPSG:4326, 90x90 deg (45S-45N, #713)",
    image: { crs: "EPSG:4326", x0: 0, y0: 45, sx: 90 / 512, sy: 90 / 512 },
  },
];

/** Count proj4 calls made by both libraries for one image. */
function setUp(spec) {
  const image = makeImage(spec);
  const counter = { n: 0 };
  // OpenLayers uses exactly the same proj4 converter, counted.
  addCoordinateTransforms(
    image.crs,
    "EPSG:3857",
    (c) => {
      counter.n++;
      return image.toMercator.forward(c);
    },
    (c) => {
      counter.n++;
      return image.toMercator.inverse(c);
    },
  );
  const map = (px, py) => image.toMercator.forward(image.pixelToCrs(px, py));
  return {
    image,
    counter,
    map,
    exactUV: (u, v) => map(u * image.width, v * image.height),
    outPx: outputPixelSize(map, image.width / 2, image.height / 2),
  };
}

function buildOurs(c, tolerance) {
  c.counter.n = 0;
  const fns = reprojectionFns(c.image, { counter: c.counter });
  const t0 = performance.now();
  const [r, capped] = withoutWarnings(() => {
    const reprojector = new RasterReprojector(
      fns,
      c.image.width + 1,
      c.image.height + 1,
      { _errorSpace: "output" },
    );
    reprojector.run(tolerance);
    return reprojector;
  });
  return {
    r,
    ms: performance.now() - t0,
    calls: c.counter.n,
    triangles: r.triangles.length / 3,
    capped,
  };
}

function buildOpenLayersSameJob(c, tolerance) {
  c.counter.n = 0;
  const t0 = performance.now();
  const triangulation = new Triangulation(
    getProjection("EPSG:3857"),
    getProjection(c.image.crs),
    c.image.extent,
    MERCATOR_EXTENT,
    tolerance * c.outPx,
    c.image.sx,
  );
  const ms = performance.now() - t0;
  const tris = triangulation.getTriangles();
  const uv = new Float64Array(6 * tris.length);
  const xy = new Float64Array(6 * tris.length);
  const [ex0, , ex1, ey1] = c.image.extent;
  const height = c.image.height * c.image.sy;
  tris.forEach((tri, t) => {
    for (let k = 0; k < 3; k++) {
      const [x, y] = tri.target[k];
      uv[6 * t + 2 * k] = (x - ex0) / (ex1 - ex0);
      uv[6 * t + 2 * k + 1] = (ey1 - y) / height;
      xy[6 * t + 2 * k] = tri.source[k][0];
      xy[6 * t + 2 * k + 1] = tri.source[k][1];
    }
  });
  return { uv, xy, ms, calls: c.counter.n, triangles: tris.length };
}

/** Median timing over `reps` runs, keeping the last run's other results. */
function timed(fn, reps = 5) {
  const times = [];
  let last;
  for (let i = 0; i < reps; i++) {
    last = fn();
    times.push(last.ms);
  }
  return { ...last, ms: median(times) };
}

/** The image's footprint in EPSG:3857, from points along its edges. */
function footprint(c, n = 64) {
  const xs = [];
  const ys = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    for (const [px, py] of [
      [f * c.image.width, 0],
      [f * c.image.width, c.image.height],
      [0, f * c.image.height],
      [c.image.width, f * c.image.height],
    ]) {
      const [x, y] = c.map(px, py);
      xs.push(x);
      ys.push(y);
    }
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Extents of the 256 px EPSG:3857 tiles at zoom z that overlap the image. */
function targetTiles(c, z) {
  const span = (2 * HALF_WORLD) / 2 ** z;
  const [fx0, fy0, fx1, fy1] = footprint(c);
  const extents = [];
  for (
    let ty = Math.floor((HALF_WORLD - fy1) / span);
    ty <= Math.floor((HALF_WORLD - fy0) / span);
    ty++
  ) {
    for (
      let tx = Math.floor((fx0 + HALF_WORLD) / span);
      tx <= Math.floor((fx1 + HALF_WORLD) / span);
      tx++
    ) {
      extents.push([
        -HALF_WORLD + tx * span,
        HALF_WORLD - (ty + 1) * span,
        -HALF_WORLD + (tx + 1) * span,
        HALF_WORLD - ty * span,
      ]);
    }
  }
  return extents;
}

/** OpenLayers' triangulation of each target tile, as `ReprojDataTile` builds it. */
function triangulateTiles(c, extents, tolerance, res) {
  const sourceProj = getProjection(c.image.crs);
  const merc = getProjection("EPSG:3857");
  return extents.map((extent) => {
    const sourceRes = calculateSourceExtentResolution(
      sourceProj,
      merc,
      extent,
      res,
    );
    return new Triangulation(
      sourceProj,
      merc,
      extent,
      c.image.extent,
      sourceRes * tolerance,
      res,
    ).getTriangles();
  });
}

/** OpenLayers as it runs: every overlapping 256 px target tile at zoom z. */
function runOpenLayersTiles(c, tolerance, z) {
  const res = (2 * HALF_WORLD) / (256 * 2 ** z);
  const span = 256 * res;
  const extents = targetTiles(c, z);
  const times = [];
  let perTile;
  for (let i = 0; i < 5; i++) {
    c.counter.n = 0;
    const t0 = performance.now();
    perTile = triangulateTiles(c, extents, tolerance, res);
    times.push(performance.now() - t0);
  }
  const calls = c.counter.n;
  let tiles = 0;
  let triangles = 0;
  const errors = [];
  let uncovered = 0;
  let total = 0;
  const samples = 48;
  const [ex0, ey0, ex1, ey1] = c.image.extent;
  for (const [index, extent] of extents.entries()) {
    const tris = perTile[index];
    if (tris.length === 0) {
      continue;
    }
    tiles++;
    triangles += tris.length;
    const target = new Float64Array(6 * tris.length);
    const source = new Float64Array(6 * tris.length);
    tris.forEach((tri, t) => {
      for (let k = 0; k < 3; k++) {
        target[6 * t + 2 * k] = tri.target[k][0];
        target[6 * t + 2 * k + 1] = tri.target[k][1];
        source[6 * t + 2 * k] = tri.source[k][0];
        source[6 * t + 2 * k + 1] = tri.source[k][1];
      }
    });
    const locator = new Locator(target, extent, 32);
    for (let j = 0; j < samples; j++) {
      for (let i = 0; i < samples; i++) {
        const X = extent[0] + ((i + 0.5) / samples) * span;
        const Y = extent[3] - ((j + 0.5) / samples) * span;
        const [sx, sy] = c.image.toMercator.inverse([X, Y]);
        // Score only screen points whose texel is inside the image.
        if (sx < ex0 || sx > ex1 || sy < ey0 || sy > ey1) {
          continue;
        }
        total++;
        const hit = locator.locate(X, Y);
        if (!hit) {
          uncovered++;
          continue;
        }
        const [t, l0, l1, l2] = hit;
        const o = 6 * t;
        const ix = l0 * source[o] + l1 * source[o + 2] + l2 * source[o + 4];
        const iy = l0 * source[o + 1] + l1 * source[o + 3] + l2 * source[o + 5];
        // The texel drawn at (X, Y) is the one at (ix, iy). Where it belongs:
        const [bx, by] = c.image.toMercator.forward([ix, iy]);
        errors.push(Math.hypot(bx - X, by - Y) / res);
      }
    }
  }
  return {
    tiles,
    triangles,
    ms: median(times),
    calls,
    ...summarize(errors, uncovered, total),
  };
}

console.log(`# OpenLayers vs RasterReprojector\n\n${environment()}\n`);
console.log("## Experiment A: same job (error in output pixels)\n");
console.log(
  '"Area over" is the share of the image drawn with more error than the tolerance. "Folded" counts inverted triangles.\n',
);
console.log(
  "| Image | Tolerance | Ours: tris | calls | ms | max err | area over % | folded | OL: tris | calls | ms | max err | area over % |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const { name, image } of CASES) {
  const c = setUp(image);
  for (const tolerance of [0.5, 0.125]) {
    const ours = timed(() => buildOurs(c, tolerance));
    const ol = timed(() => buildOpenLayersSameJob(c, tolerance));
    const ourErr = meshError(reprojectorTriangles(ours.r), c.exactUV, c.outPx, {
      tolerance,
    });
    const olErr = meshError(ol, c.exactUV, c.outPx, { tolerance });
    console.log(
      `| ${name} | ${tolerance} | ${ours.triangles}${ours.capped ? " (cap)" : ""} | ${ours.calls} | ${fmt(ours.ms)} | ${fmt(ourErr.max, 3)} | ${fmt(ourErr.overPct)} | ${ourErr.inverted} | ${ol.triangles} | ${ol.calls} | ${fmt(ol.ms)} | ${fmt(olErr.max, 3)} | ${fmt(olErr.overPct)} |`,
    );
  }
}

console.log(
  "\n## Experiment B: as each library runs (error in screen pixels at zoom z)\n",
);
console.log(
  "| Image | Tolerance | z | Ours: tris | calls | ms | max err | OL: tiles | tris | calls | ms | max err | uncovered % |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const { name, image } of CASES.slice(1, 6)) {
  const c = setUp(image);
  // The zoom where one screen pixel is about one source pixel at the centre.
  const z = Math.round(Math.log2((2 * HALF_WORLD) / (256 * c.outPx)));
  const res = (2 * HALF_WORLD) / (256 * 2 ** z);
  for (const tolerance of [0.5, 0.125]) {
    const ol = runOpenLayersTiles(c, tolerance, z);
    const ours = timed(() => buildOurs(c, tolerance));
    const ourErr = meshError(reprojectorTriangles(ours.r), c.exactUV, res, {
      tolerance,
    });
    console.log(
      `| ${name} | ${tolerance} | ${z} | ${ours.triangles} | ${ours.calls} | ${fmt(ours.ms)} | ${fmt(ourErr.max, 3)} | ${ol.tiles} | ${ol.triangles} | ${ol.calls} | ${fmt(ol.ms)} | ${fmt(ol.max, 3)} | ${fmt(ol.uncoveredPct)} |`,
    );
  }
}
