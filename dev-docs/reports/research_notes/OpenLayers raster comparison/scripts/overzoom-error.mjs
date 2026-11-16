/**
 * Mesh error under overzoom, in Web Mercator metres, so it can be read at any
 * zoom. A 512 px, 10 m UTM 33N tile (5 km, like a Sentinel-2 tile at full
 * resolution): our mesh is built once for the tile at 0.125 output px;
 * OpenLayers meshes its EPSG:3857 target tiles down to its finest target
 * level for this source and magnifies those beyond it. See README.md.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  environment,
  fmt,
  HALF_WORLD,
  Locator,
  loadReprojector,
  makeImage,
  meshError,
  OPENLAYERS_COMMIT,
  proj4,
  reprojectionFns,
  reprojectorTriangles,
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

const image = makeImage({
  crs: "EPSG:32633",
  x0: 300000,
  y0: 5000000,
  sx: 10,
  sy: 10,
});
addCoordinateTransforms(
  image.crs,
  "EPSG:3857",
  (c) => image.toMercator.forward(c),
  (c) => image.toMercator.inverse(c),
);
const map = (px, py) => image.toMercator.forward(image.pixelToCrs(px, py));
const exactUV = (u, v) => map(u * image.width, v * image.height);

/** Metres of Web Mercator per CSS pixel at a deck.gl/MapLibre zoom. */
const metresPerPixel = (zoom) => (2 * HALF_WORLD) / (512 * 2 ** zoom);

// Ours: one mesh per source tile.
const [r] = withoutWarnings(() => {
  const reprojector = new RasterReprojector(
    reprojectionFns(image),
    image.width + 1,
    image.height + 1,
    { _errorSpace: "output" },
  );
  reprojector.run(0.125);
  return reprojector;
});
const ours = meshError(reprojectorTriangles(r), exactUV, 1);

// OpenLayers caps its target grid one level past the source's finest
// resolution (`DataTileSource#getTileGridForProjection`): ceil(log2(156543 /
// 10)) + 1 = 15 for 256 px tiles.
const olZoom = Math.ceil(Math.log2((2 * HALF_WORLD) / 256 / image.sx)) + 1;
const res = (2 * HALF_WORLD) / (256 * 2 ** olZoom);
const span = 256 * res;
const corners = [
  map(0, 0),
  map(image.width, 0),
  map(0, image.height),
  map(image.width, image.height),
];
const [fx0, fx1] = [
  Math.min(...corners.map((p) => p[0])),
  Math.max(...corners.map((p) => p[0])),
];
const [fy0, fy1] = [
  Math.min(...corners.map((p) => p[1])),
  Math.max(...corners.map((p) => p[1])),
];
const sourceProj = getProjection(image.crs);
const merc = getProjection("EPSG:3857");
const [ex0, ey0, ex1, ey1] = image.extent;
let olMax = 0;
let olTriangles = 0;
let olTiles = 0;
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
    const extent = [
      -HALF_WORLD + tx * span,
      HALF_WORLD - (ty + 1) * span,
      -HALF_WORLD + (tx + 1) * span,
      HALF_WORLD - ty * span,
    ];
    const sourceRes = calculateSourceExtentResolution(
      sourceProj,
      merc,
      extent,
      res,
    );
    const tris = new Triangulation(
      sourceProj,
      merc,
      extent,
      image.extent,
      sourceRes * 0.5,
      res,
    ).getTriangles();
    if (tris.length === 0) {
      continue;
    }
    olTiles++;
    olTriangles += tris.length;
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
    const locator = new Locator(target, extent, 16);
    const samples = 24;
    for (let j = 0; j < samples; j++) {
      for (let i = 0; i < samples; i++) {
        const X = extent[0] + ((i + 0.5) / samples) * span;
        const Y = extent[3] - ((j + 0.5) / samples) * span;
        const [sx, sy] = image.toMercator.inverse([X, Y]);
        if (sx < ex0 || sx > ex1 || sy < ey0 || sy > ey1) {
          continue;
        }
        const hit = locator.locate(X, Y);
        if (!hit) {
          continue;
        }
        const [t, l0, l1, l2] = hit;
        const o = 6 * t;
        const ix = l0 * source[o] + l1 * source[o + 2] + l2 * source[o + 4];
        const iy = l0 * source[o + 1] + l1 * source[o + 3] + l2 * source[o + 5];
        const [bx, by] = image.toMercator.forward([ix, iy]);
        olMax = Math.max(olMax, Math.hypot(bx - X, by - Y));
      }
    }
  }
}

console.log(`# Mesh error under overzoom\n\n${environment()}\n`);
console.log(
  "| Mesh | Triangles | Max error (Mercator m) | CSS px at zoom 16 | zoom 18 | zoom 20 |",
);
console.log("|---|---|---|---|---|---|");
for (const [name, triangles, metres] of [
  [
    "Ours: one mesh for the tile, 0.125 output px",
    r.triangles.length / 3,
    ours.max,
  ],
  [
    `OpenLayers: ${olTiles} target tiles at its finest level (OL z${olZoom}), 0.5 px`,
    olTriangles,
    olMax,
  ],
]) {
  console.log(
    `| ${name} | ${triangles} | ${fmt(metres, 3)} | ${fmt(metres / metresPerPixel(16))} | ${fmt(metres / metresPerPixel(18))} | ${fmt(metres / metresPerPixel(20))} |`,
  );
}
