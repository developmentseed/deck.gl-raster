/**
 * On-demand comparison of the two error spaces, input and output (not part of
 * the regular test run). Prints a markdown table of triangle counts, worst
 * errors in both units, projection calls and time, for each case, tolerance
 * and mode:
 *
 *   COMPARE_ERROR_SPACES=1 pnpm exec vitest run tests/compare-error-spaces.test.ts --silent=false
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as affine from "@developmentseed/affine";
import proj4 from "proj4";
import { describe, it } from "vitest";
import type { ReprojectionFns } from "../src/delatin.js";
import { RasterReprojector } from "../src/delatin.js";

const FIXTURES = resolve(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures"),
);

/** The reprojector's test points, in barycentric coordinates. */
const SAMPLES: [number, number, number][] = [
  [1 / 3, 1 / 3, 1 / 3],
  [0.5, 0.5, 0],
  [0.5, 0, 0.5],
  [0, 0.5, 0.5],
];

/** NSIDC north polar stereographic (EPSG:3413). */
const POLAR =
  "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";

/** The longest side, in pixels, a fixture is scaled down to. */
const MAX_SIDE = 2048;

type Case = {
  name: string;
  fns: ReprojectionFns;
  width: number;
  height: number;
};

/** Reprojection functions from an affine geotransform and a proj4 converter. */
function makeFns(
  geotransform: affine.Affine,
  from: string | object,
  to: string,
): ReprojectionFns {
  const inverse = affine.invert(geotransform);
  const converter = proj4(from as string, to);
  return {
    forwardTransform: (x, y) => affine.apply(geotransform, x, y),
    inverseTransform: (x, y) => affine.apply(inverse, x, y),
    forwardReproject: (x, y) =>
      converter.forward<[number, number]>([x, y], false),
    inverseReproject: (x, y) =>
      converter.inverse<[number, number]>([x, y], false),
  };
}

/**
 * A fixture JSON (GDAL-ordered geotransform + CRS), scaled to an overview at
 * most {@link MAX_SIDE} pixels on its long side, reprojected to Web Mercator.
 */
function fixtureCase(name: string, file: string): Case {
  const { width, height, geotransform, reorderTransform, projjson, wkt2 } =
    JSON.parse(readFileSync(join(FIXTURES, file), "utf-8"));
  const g = geotransform as number[];
  const geo: affine.Affine =
    reorderTransform === false
      ? (g as unknown as affine.Affine)
      : [g[1]!, g[2]!, g[0]!, g[4]!, g[5]!, g[3]!];
  const scale = Math.max(1, Math.max(width, height) / MAX_SIDE);
  const overview: affine.Affine = [
    geo[0] * scale,
    geo[1] * scale,
    geo[2],
    geo[3] * scale,
    geo[4] * scale,
    geo[5],
  ];
  return {
    name: `${name} (${Math.round(width / scale)}×${Math.round(height / scale)})`,
    fns: makeFns(overview, projjson || wkt2, "EPSG:3857"),
    width: Math.round(width / scale),
    height: Math.round(height / scale),
  };
}

/**
 * One input pixel's size on the map at the image center, as the reprojector
 * measures it in output mode: the square root of the pixel's area there,
 * `√|det J|`, from steps of half a pixel either side. The unit for scoring
 * meshes from either mode in output pixels.
 */
function pixelSize(r: RasterReprojector): number {
  const f = (px: number, py: number) =>
    r.reprojectors.forwardReproject(...r.reprojectors.forwardTransform(px, py));
  const px = 0.5 * (r.width - 1);
  const py = 0.5 * (r.height - 1);
  const left = f(px - 0.5, py);
  const right = f(px + 0.5, py);
  const up = f(px, py - 0.5);
  const down = f(px, py + 0.5);
  const rx = right[0] - left[0];
  const ry = right[1] - left[1];
  const dx = down[0] - up[0];
  const dy = down[1] - up[1];
  return Math.sqrt(Math.abs(rx * dy - ry * dx));
}

/** A finished mesh's worst error in both units, at the 4 test points per triangle. */
function score(r: RasterReprojector): { inOutput: number; inInput: number } {
  const fns = r.reprojectors;
  const size = pixelSize(r);
  const { uvs, exactOutputPositions: out, triangles } = r;
  let inOutput = 0;
  let inInput = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = 2 * triangles[t]!;
    const b = 2 * triangles[t + 1]!;
    const c = 2 * triangles[t + 2]!;
    for (const [w0, w1, w2] of SAMPLES) {
      const px = (w0 * uvs[a]! + w1 * uvs[b]! + w2 * uvs[c]!) * (r.width - 1);
      const py =
        (w0 * uvs[a + 1]! + w1 * uvs[b + 1]! + w2 * uvs[c + 1]!) *
        (r.height - 1);
      const gx = w0 * out[a]! + w1 * out[b]! + w2 * out[c]!;
      const gy = w0 * out[a + 1]! + w1 * out[b + 1]! + w2 * out[c + 1]!;
      const [ex, ey] = fns.forwardReproject(...fns.forwardTransform(px, py));
      inOutput = Math.max(inOutput, Math.hypot(ex - gx, ey - gy) / size);
      const [sx, sy] = fns.inverseTransform(...fns.inverseReproject(gx, gy));
      inInput = Math.max(inInput, Math.hypot(sx - px, sy - py));
    }
  }
  return { inOutput, inInput };
}

const CASES: Case[] = [
  fixtureCase("NLCD, Albers", "Annual_NLCD_LndCov_2023_CU_C1V0.json"),
  fixtureCase("NAIP, UTM 18N", "m_4007307_sw_18_060_20220803.json"),
  fixtureCase("LINZ, NZTM", "linz_250-25_GeoTifv1-05.json"),
  fixtureCase(
    "MODIS, sinusoidal",
    "MYD09A1.A2025169.h10v05.061.2025178160305.json",
  ),
  {
    name: "EPSG:4326 60–85°N (512×512)",
    fns: makeFns([40 / 512, 0, 0, 0, -25 / 512, 85], "EPSG:4326", "EPSG:3857"),
    width: 512,
    height: 512,
  },
  {
    name: "EPSG:4326 67.5–89.9°N tile → EPSG:3413 (512×512)",
    fns: makeFns([45 / 512, 0, -45, 0, -22.4 / 512, 89.9], "EPSG:4326", POLAR),
    width: 512,
    height: 512,
  },
  {
    name: "EPSG:4326 band 30–85°N → EPSG:3413 (2048×313)",
    fns: makeFns(
      [359.8 / 2048, 0, -179.9, 0, -55 / 313, 85],
      "EPSG:4326",
      POLAR,
    ),
    width: 2048,
    height: 313,
  },
];

describe.runIf(process.env.COMPARE_ERROR_SPACES)("compare error spaces", () => {
  it("prints a table", () => {
    const rows = [
      "| Case | Tolerance | Mode | Triangles | Worst in output px | Worst in input px | Forward calls | Inverse calls | ms |",
      "|---|---|---|---|---|---|---|---|---|",
    ];
    for (const c of CASES) {
      for (const tolerance of [0.125, 1, 4]) {
        for (const errorSpace of ["input", "output"] as const) {
          let forward = 0;
          let inverse = 0;
          const fns: ReprojectionFns = {
            ...c.fns,
            forwardReproject: (x, y) => {
              forward++;
              return c.fns.forwardReproject(x, y);
            },
            inverseReproject: (x, y) => {
              inverse++;
              return c.fns.inverseReproject(x, y);
            },
          };
          const start = performance.now();
          const r = new RasterReprojector(fns, c.width + 1, c.height + 1, {
            _errorSpace: errorSpace,
          });
          r.run(tolerance, { maxIterations: 200_000 });
          const ms = performance.now() - start;
          const calls = [forward, inverse];
          const { inOutput, inInput } = score(r);
          rows.push(
            `| ${c.name} | ${tolerance} | ${errorSpace} | ${r.triangles.length / 3} | ${inOutput.toFixed(3)} | ${inInput.toFixed(3)} | ${calls[0]} | ${calls[1]} | ${ms.toFixed(0)} |`,
          );
        }
      }
    }
    console.log(rows.join("\n"));
  }, 600_000);
});
