import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import {
  clipPath,
  densify,
  domainOutline,
  graticule,
  projectPath,
} from "../src/context-layers.js";

const ARCTIC = proj4(
  "EPSG:4326",
  "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
);
const EQUAL_EARTH = proj4(
  "EPSG:4326",
  "+proj=eqearth +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
);

describe("clipPath", () => {
  it("splits a line where it leaves the domain and ends on the boundary", () => {
    const parts = clipPath(
      [
        [0, 10],
        [0, -10],
        [10, -10],
        [10, 10],
      ],
      [-180, 0, 180, 90],
    );
    expect(parts).toEqual([
      [
        [0, 10],
        [0, 0],
      ],
      [
        [10, 0],
        [10, 10],
      ],
    ]);
  });

  it("drops lines entirely outside the domain", () => {
    expect(
      clipPath(
        [
          [0, -10],
          [10, -20],
        ],
        [-180, 0, 180, 90],
      ),
    ).toEqual([]);
  });
});

describe("densify", () => {
  it("limits vertex spacing", () => {
    const path = densify(
      [
        [0, 0],
        [10, 0],
      ],
      1,
    );
    expect(path).toHaveLength(11);
    expect(path[5]).toEqual([5, 0]);
  });
});

describe("projectPath", () => {
  it("splits at non-finite projected points", () => {
    const project = ([lng, lat]: number[]) =>
      lng === 1 ? [Number.NaN, Number.NaN] : [lng!, lat!];
    expect(
      projectPath(
        [
          [0, 0],
          [0.5, 0],
          [1, 0],
          [2, 0],
          [3, 0],
        ],
        project,
      ),
    ).toEqual([
      [
        [0, 0],
        [0.5, 0],
      ],
      [
        [2, 0],
        [3, 0],
      ],
    ]);
  });
});

describe("graticule", () => {
  it("skips parallels at the poles", () => {
    const lines = graticule([-180, 0, 180, 90], { lng: 90, lat: 30 });
    const parallels = lines.filter((line) => line[0]![1] === line[1]![1]);
    expect(parallels.map((line) => line[0]![1])).toEqual([0, 30, 60]);
  });
});

describe("domainOutline", () => {
  it("draws only the rim of an azimuthal map", () => {
    // The ±180° meridians meet inside the map, and the pole is a point.
    const edges = domainOutline([-180, 0, 180, 90], (p) => ARCTIC.forward(p));
    expect(edges).toHaveLength(1);
  });

  it("keeps all four edges of a world map", () => {
    const edges = domainOutline([-180, -90, 180, 90], (p) =>
      EQUAL_EARTH.forward(p),
    );
    expect(edges).toHaveLength(4);
  });
});
