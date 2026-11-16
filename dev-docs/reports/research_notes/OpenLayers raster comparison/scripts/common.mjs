/**
 * Shared setup for the scripts in this folder: the commits that were
 * measured, proj4, `RasterReprojector` variants, and a mesh's true error.
 * See README.md.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Root of the deck.gl-raster checkout that holds this folder. */
export const REPO_ROOT = fileURLToPath(
  new URL("../../../../../", import.meta.url),
);

/** deck.gl-raster `main` when the comparison was made (0.10.0-beta.4). */
export const STUDIED_COMMIT = "a72d7a147717d0bf4ef7745ae1c887bcab6ae023";

/** Head of PR #759 (edge-midpoint memo) when it was measured. */
export const PR_759_COMMIT = "0f1eaac68a00165775df8afbe7cc9f111cc3a794";

/** The OpenLayers commit that was read and measured (10.11.1-dev). */
export const OPENLAYERS_COMMIT = "e50554baf350ea5ab1c1db6e7aa530b29fc5681f";

const require = createRequire(
  join(REPO_ROOT, "packages/raster-reproject/package.json"),
);

/** proj4, resolved from `@developmentseed/raster-reproject`. */
export const proj4 = require("proj4");

proj4.defs(
  "EPSG:32633",
  "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs +type=crs",
);
proj4.defs(
  "EPSG:3413",
  "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs +type=crs",
);

/** Half the width of the Web Mercator world, in metres. */
export const HALF_WORLD = Math.PI * 6378137;

/** Web Mercator's latitude limit, in degrees. */
export const MAX_MERCATOR_LAT = 85.0511287798066;

/** One line describing the machine and versions, for result files. */
export function environment() {
  return `node ${process.version}, proj4 ${proj4.version}, ${cpus()[0]?.model ?? "unknown CPU"}, ${process.platform}`;
}

/** Median of an array of numbers. */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/** Read a file of this repository at a commit. */
function gitShow(commit, path) {
  try {
    return execFileSync("git", ["-C", REPO_ROOT, "show", `${commit}:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      `Can't read ${path} at ${commit}. For PR #759's commit, run \`git fetch origin pull/759/head\` first.`,
      { cause: error },
    );
  }
}

/** Replace the single occurrence of `find` in `source`. */
function replaceOnce(source, find, replace) {
  const parts = source.split(find);
  if (parts.length !== 2) {
    throw new Error(
      `Expected one match, found ${parts.length - 1}, for:\n${find}`,
    );
  }
  return parts.join(replace);
}

/**
 * Appended to `delatin.ts` by {@link withMapSpaceDelaunayTest}: `+1` when the
 * seed's first triangle keeps its orientation on the map, `-1` when the map
 * mirrors it (Web Mercator y grows north while v grows south).
 */
const MAP_SPACE_SIGN = `

function mapSpaceSign(r: RasterReprojector): number {
  const a = 2 * r.triangles[0]!;
  const b = 2 * r.triangles[1]!;
  const c = 2 * r.triangles[2]!;
  const u = r.uvs;
  const o = r.exactOutputPositions;
  const inUv = orient(u[a]!, u[a + 1]!, u[b]!, u[b + 1]!, u[c]!, u[c + 1]!);
  const onMap = orient(o[a]!, o[a + 1]!, o[b]!, o[b + 1]!, o[c]!, o[c + 1]!);
  return Math.sign(inUv) === Math.sign(onMap) ? 1 : -1;
}
`;

/**
 * Prototype: run `_legalize`'s Delaunay (in-circle) test on the vertices'
 * output positions instead of their UV positions, so triangles are well
 * shaped on the map. Y is multiplied by the orientation sign so the test
 * keeps the UV triangles' winding.
 */
export function withMapSpaceDelaunayTest(source) {
  let out = replaceOnce(
    source,
    "    this._seed(seed);\n    this._flush();\n",
    "    this._seed(seed);\n    this._outSign = mapSpaceSign(this);\n    this._flush();\n",
  );
  out = replaceOnce(
    out,
    "    const uvs = this.uvs;\n",
    "    const uvs = this.exactOutputPositions;\n    const s = this._outSign;\n",
  );
  for (const p of ["p0", "pr", "pl", "p1"]) {
    out = replaceOnce(
      out,
      `        uvs[2 * ${p} + 1]!,\n`,
      `        s * uvs[2 * ${p} + 1]!,\n`,
    );
  }
  return out + MAP_SPACE_SIGN;
}

/**
 * Import `RasterReprojector` and `triangulateRectangle` from
 * `packages/raster-reproject/src/delatin.ts` at a commit, optionally with
 * {@link withMapSpaceDelaunayTest} applied. Needs Node's TypeScript type
 * stripping (Node 22.18 or later).
 */
export async function loadReprojector({
  commit = STUDIED_COMMIT,
  mapSpace = false,
} = {}) {
  let source = gitShow(commit, "packages/raster-reproject/src/delatin.ts");
  if (mapSpace) {
    source = withMapSpaceDelaunayTest(source);
  }
  const dir = mkdtempSync(join(tmpdir(), "raster-reproject-"));
  const file = join(dir, "delatin.ts");
  writeFileSync(file, source);
  return import(pathToFileURL(file).href);
}

/**
 * A north-up source image: CRS, top-left corner, pixel size and size in
 * pixels. `forward` maps source CRS coordinates to the output space.
 */
export function makeImage({ crs, x0, y0, sx, sy, width = 512, height = 512 }) {
  const toMercator = proj4(crs, "EPSG:3857");
  return {
    crs,
    x0,
    y0,
    sx,
    sy,
    width,
    height,
    toMercator,
    /** Source CRS coordinates of a pixel position. */
    pixelToCrs: (px, py) => [x0 + px * sx, y0 - py * sy],
    /** Image extent in the source CRS: [minX, minY, maxX, maxY]. */
    extent: [x0, y0 - height * sy, x0 + width * sx, y0],
  };
}

/** Web Mercator metres to deck.gl common space (a 512-unit world). */
export function mercatorToCommon([mx, my]) {
  return [
    (mx / (2 * HALF_WORLD) + 0.5) * 512,
    (my / (2 * HALF_WORLD) + 0.5) * 512,
  ];
}

/** deck.gl common space to Web Mercator metres. */
export function commonToMercator(cx, cy) {
  return [(cx / 512 - 0.5) * 2 * HALF_WORLD, (cy / 512 - 0.5) * 2 * HALF_WORLD];
}

/**
 * `ReprojectionFns` for an image, to Web Mercator metres or to deck.gl common
 * space as `RasterTileLayer` uses. `counter.n` counts forward projections.
 */
export function reprojectionFns(image, { space = "mercator", counter } = {}) {
  const { toMercator, x0, y0, sx, sy } = image;
  const toOutput = space === "common" ? mercatorToCommon : (p) => p;
  const fromOutput = space === "common" ? commonToMercator : (x, y) => [x, y];
  return {
    forwardTransform: (px, py) => [x0 + px * sx, y0 - py * sy],
    inverseTransform: (x, y) => [(x - x0) / sx, (y0 - y) / sy],
    forwardReproject: (x, y) => {
      if (counter) {
        counter.n++;
      }
      return toOutput(toMercator.forward([x, y]));
    },
    inverseReproject: (x, y) => toMercator.inverse(fromOutput(x, y)),
  };
}

/**
 * One source pixel's size on the map at a pixel position: the square root of
 * the Jacobian's determinant, from half-pixel steps. This is the unit of
 * `RasterReprojector`'s output-mode error.
 */
export function outputPixelSize(map, px, py) {
  const left = map(px - 0.5, py);
  const right = map(px + 0.5, py);
  const up = map(px, py - 0.5);
  const down = map(px, py + 0.5);
  return Math.sqrt(
    Math.abs(
      (right[0] - left[0]) * (down[1] - up[1]) -
        (right[1] - left[1]) * (down[0] - up[0]),
    ),
  );
}

/** Bucketed point location over unindexed triangles in a 2D domain. */
export class Locator {
  /**
   * @param {Float64Array} triangles 6 numbers per triangle: x0 y0 x1 y1 x2 y2
   * @param {number[]} bbox [minX, minY, maxX, maxY] of the domain
   */
  constructor(triangles, bbox, grid = 64) {
    this.triangles = triangles;
    this.bbox = bbox;
    this.grid = grid;
    this.buckets = Array.from({ length: grid * grid }, () => []);
    for (let t = 0; t < triangles.length / 6; t++) {
      const o = 6 * t;
      const xs = [triangles[o], triangles[o + 2], triangles[o + 4]];
      const ys = [triangles[o + 1], triangles[o + 3], triangles[o + 5]];
      for (
        let j = this._row(Math.min(...ys));
        j <= this._row(Math.max(...ys));
        j++
      ) {
        for (
          let i = this._col(Math.min(...xs));
          i <= this._col(Math.max(...xs));
          i++
        ) {
          this.buckets[j * grid + i].push(t);
        }
      }
    }
  }

  _col(x) {
    const [minX, , maxX] = this.bbox;
    const i = Math.floor(((x - minX) / (maxX - minX)) * this.grid);
    return Math.max(0, Math.min(this.grid - 1, i));
  }

  _row(y) {
    const [, minY, , maxY] = this.bbox;
    const j = Math.floor(((y - minY) / (maxY - minY)) * this.grid);
    return Math.max(0, Math.min(this.grid - 1, j));
  }

  /** The triangle containing (x, y) and its barycentric weights, or null. */
  locate(x, y) {
    const tri = this.triangles;
    for (const t of this.buckets[this._row(y) * this.grid + this._col(x)]) {
      const o = 6 * t;
      const [x0, y0, x1, y1, x2, y2] = tri.subarray(o, o + 6);
      const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (det === 0) {
        continue;
      }
      const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / det;
      const l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / det;
      const l2 = 1 - l0 - l1;
      if (l0 >= -1e-9 && l1 >= -1e-9 && l2 >= -1e-9) {
        return [t, l0, l1, l2];
      }
    }
    return null;
  }
}

/** A `RasterReprojector`'s triangles as UV and output-position triples. */
export function reprojectorTriangles(r) {
  const count = r.triangles.length / 3;
  const uv = new Float64Array(6 * count);
  const xy = new Float64Array(6 * count);
  for (let t = 0; t < count; t++) {
    for (let c = 0; c < 3; c++) {
      const v = r.triangles[3 * t + c];
      uv[6 * t + 2 * c] = r.uvs[2 * v];
      uv[6 * t + 2 * c + 1] = r.uvs[2 * v + 1];
      xy[6 * t + 2 * c] = r.exactOutputPositions[2 * v];
      xy[6 * t + 2 * c + 1] = r.exactOutputPositions[2 * v + 1];
    }
  }
  return { uv, xy };
}

/**
 * The true error of a mesh, measured inside each triangle as the GPU draws
 * it: at points of a barycentric grid (one step per 4 px of a 512 px image,
 * at least 6 per edge), the distance between the interpolated output position
 * and the exact one, `exact(u, v)`, divided by `unit`.
 *
 * Also returns the share of the drawn area whose error is over `tolerance`,
 * the count of inverted (folded) and zero-area triangles, and the summed UV
 * area of the triangles (1 for a mesh that covers a unit square once).
 *
 * Sampling each triangle, rather than locating grid points in the mesh, keeps
 * zero-area and folded triangles from producing spurious errors.
 */
export function meshError(
  { uv, xy },
  exact,
  unit,
  { tolerance = Infinity } = {},
) {
  const count = uv.length / 6;
  const areas = new Float64Array(count);
  let signed = 0;
  for (let t = 0; t < count; t++) {
    const o = 6 * t;
    areas[t] =
      ((uv[o + 2] - uv[o]) * (uv[o + 5] - uv[o + 1]) -
        (uv[o + 3] - uv[o + 1]) * (uv[o + 4] - uv[o])) /
      2;
    signed += areas[t];
  }
  const orientation = Math.sign(signed);
  let max = 0;
  let overArea = 0;
  let area = 0;
  let inverted = 0;
  let zeroArea = 0;
  for (let t = 0; t < count; t++) {
    if (areas[t] === 0) {
      zeroArea++;
      continue;
    }
    if (Math.sign(areas[t]) !== orientation) {
      inverted++;
    }
    area += Math.abs(areas[t]);
    const o = 6 * t;
    const longest = Math.max(
      Math.hypot(uv[o + 2] - uv[o], uv[o + 3] - uv[o + 1]),
      Math.hypot(uv[o + 4] - uv[o + 2], uv[o + 5] - uv[o + 3]),
      Math.hypot(uv[o] - uv[o + 4], uv[o + 1] - uv[o + 5]),
    );
    const k = Math.max(6, Math.ceil(longest * 128));
    let over = 0;
    let samples = 0;
    for (let i = 0; i <= k; i++) {
      for (let j = 0; i + j <= k; j++) {
        const l0 = i / k;
        const l1 = j / k;
        const l2 = 1 - l0 - l1;
        const u = l0 * uv[o] + l1 * uv[o + 2] + l2 * uv[o + 4];
        const v = l0 * uv[o + 1] + l1 * uv[o + 3] + l2 * uv[o + 5];
        const x = l0 * xy[o] + l1 * xy[o + 2] + l2 * xy[o + 4];
        const y = l0 * xy[o + 1] + l1 * xy[o + 3] + l2 * xy[o + 5];
        const [ex, ey] = exact(u, v);
        const e = Math.hypot(x - ex, y - ey) / unit;
        max = Math.max(max, e);
        if (e > tolerance) {
          over++;
        }
        samples++;
      }
    }
    overArea += (Math.abs(areas[t]) * over) / samples;
  }
  return {
    max,
    overPct: (100 * overArea) / area,
    inverted,
    zeroArea,
    area,
  };
}

/** Max, 99th percentile and mean of errors, and the uncovered share. */
export function summarize(errors, uncovered, total) {
  const sorted = Float64Array.from(errors).sort();
  let sum = 0;
  for (const e of sorted) {
    sum += e;
  }
  return {
    max: sorted.length ? sorted[sorted.length - 1] : Number.NaN,
    p99: sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.floor(0.99 * sorted.length))]
      : Number.NaN,
    mean: sum / sorted.length,
    uncoveredPct: (100 * uncovered) / total,
  };
}

/** Duplicate vertices, and zero-area and inverted (folded) UV triangles. */
export function degenerateCount(r) {
  const seen = new Set();
  let duplicateVertices = 0;
  for (let i = 0; i < r.uvs.length; i += 2) {
    const key = `${r.uvs[i]},${r.uvs[i + 1]}`;
    if (seen.has(key)) {
      duplicateVertices++;
    } else {
      seen.add(key);
    }
  }
  const areas = [];
  let signed = 0;
  for (let t = 0; t < r.triangles.length; t += 3) {
    const a = 2 * r.triangles[t];
    const b = 2 * r.triangles[t + 1];
    const c = 2 * r.triangles[t + 2];
    const u = r.uvs;
    const area =
      (u[b] - u[a]) * (u[c + 1] - u[a + 1]) -
      (u[b + 1] - u[a + 1]) * (u[c] - u[a]);
    areas.push(area);
    signed += area;
  }
  const orientation = Math.sign(signed);
  let zeroAreaTriangles = 0;
  let invertedTriangles = 0;
  for (const area of areas) {
    if (area === 0) {
      zeroAreaTriangles++;
    } else if (Math.sign(area) !== orientation) {
      invertedTriangles++;
    }
  }
  return { duplicateVertices, zeroAreaTriangles, invertedTriangles };
}

/** Run `fn` with `console.warn` silenced; returns [result, warned]. */
export function withoutWarnings(fn) {
  const warn = console.warn;
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  try {
    return [fn(), warned];
  } finally {
    console.warn = warn;
  }
}

/** Format a number for a Markdown table. */
export function fmt(x, digits = 2) {
  return Number.isFinite(x) ? x.toFixed(digits) : String(x);
}
