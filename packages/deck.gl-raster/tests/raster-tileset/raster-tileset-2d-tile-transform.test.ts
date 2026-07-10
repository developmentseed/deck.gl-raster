import type { _Tileset2DProps as Tileset2DProps } from "@deck.gl/geo-layers";
import { compose, scale, translation } from "@developmentseed/affine";
import { describe, expect, it } from "vitest";
import { AffineTileset } from "../../src/raster-tileset/affine-tileset.js";
import { AffineTilesetLevel } from "../../src/raster-tileset/affine-tileset-level.js";
import { RasterTileset2D } from "../../src/raster-tileset/raster-tileset-2d.js";

const identity = (x: number, y: number): [number, number] => [x, y];

const PROJECTIONS = {
  projectTo3857: identity,
  projectFrom3857: identity,
  projectTo4326: identity,
  projectFrom4326: identity,
};

function tilesetProps(): Tileset2DProps {
  return { getTileData: () => new Promise(() => {}) } as Tileset2DProps;
}

describe("RasterTileset2D.getTileMetadata", () => {
  it("attaches per-tile forwardTransform/inverseTransform to RasterTileMetadata", () => {
    const level = new AffineTilesetLevel({
      affine: compose(translation(100, 200), scale(10, -10)),
      arrayWidth: 8,
      arrayHeight: 8,
      tileWidth: 4,
      tileHeight: 4,
      mpu: 1,
    });
    const descriptor = new AffineTileset({
      levels: [level],
      ...PROJECTIONS,
    });
    const tileset = new RasterTileset2D(tilesetProps(), descriptor);

    const metadata = tileset.getTileMetadata({ x: 1, y: 1, z: 0 });

    expect(typeof metadata.forwardTransform).toBe("function");
    expect(typeof metadata.inverseTransform).toBe("function");

    // Tile (1,1) at pixel (0,0) should map to the CRS origin of that tile.
    // Tile is 4x4 pixels at 10 CRS units/pixel from origin (100, 200), Y flipped.
    const [x, y] = metadata.forwardTransform(0, 0);
    expect(x).toBeCloseTo(140, 10);
    expect(y).toBeCloseTo(160, 10);

    // Round-trip via inverseTransform.
    const [px, py] = metadata.inverseTransform(x, y);
    expect(px).toBeCloseTo(0, 10);
    expect(py).toBeCloseTo(0, 10);
  });

  it("attaches common-space _projectPosition/_unprojectPosition that round-trip", () => {
    const level = new AffineTilesetLevel({
      affine: compose(translation(0, 0), scale(1, -1)),
      arrayWidth: 8,
      arrayHeight: 8,
      tileWidth: 4,
      tileHeight: 4,
      mpu: 1,
    });
    const descriptor = new AffineTileset({
      levels: [level],
      ...PROJECTIONS,
    });
    const tileset = new RasterTileset2D(tilesetProps(), descriptor);

    const metadata = tileset.getTileMetadata({ x: 0, y: 0, z: 0 });

    expect(typeof metadata._projectPosition).toBe("function");
    expect(typeof metadata._unprojectPosition).toBe("function");

    // PROJECTIONS are identity, so source CRS == EPSG:3857. The 3857 origin
    // (0, 0) sits at the center of deck.gl common space (TILE_SIZE / 2 = 256).
    const [cx, cy] = metadata._projectPosition(0, 0);
    expect(cx).toBeCloseTo(256, 10);
    expect(cy).toBeCloseTo(256, 10);

    const [mx, my] = metadata._unprojectPosition(cx, cy);
    expect(mx).toBeCloseTo(0, 6);
    expect(my).toBeCloseTo(0, 6);
  });

  it("shares one reference-stable projection closure across all tiles", () => {
    const level = new AffineTilesetLevel({
      affine: compose(translation(0, 0), scale(1, -1)),
      arrayWidth: 8,
      arrayHeight: 8,
      tileWidth: 4,
      tileHeight: 4,
      mpu: 1,
    });
    const descriptor = new AffineTileset({
      levels: [level],
      ...PROJECTIONS,
    });
    const tileset = new RasterTileset2D(tilesetProps(), descriptor);

    // The reproject closures are built once on the tileset, so every tile's
    // metadata exposes the *same* function reference. RasterLayer relies on
    // this stability to avoid regenerating the mesh — and recompiling the
    // shader — on every render.
    const a = tileset.getTileMetadata({ x: 0, y: 0, z: 0 });
    const b = tileset.getTileMetadata({ x: 1, y: 1, z: 0 });

    expect(a._projectPosition).toBe(b._projectPosition);
    expect(a._unprojectPosition).toBe(b._unprojectPosition);
  });
});
