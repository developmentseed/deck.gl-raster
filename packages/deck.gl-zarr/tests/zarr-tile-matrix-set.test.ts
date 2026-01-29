import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ZarrMultiscaleMetadata, ZarrLevelMetadata } from "zarr-multiscale-metadata";
import { createFormatDescriptor } from "zarr-multiscale-metadata";
import { parseZarrTileMatrixSet } from "../src/zarr-tile-matrix-set.js";
import type { Bounds } from "../src/types.js";

// Mock fetch for CRS resolution
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  // Mock fetch to return appropriate proj4 strings based on EPSG code
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes("32632")) {
      // UTM Zone 32N
      return {
        ok: true,
        text: async () => "+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs",
      };
    }
    // Default: EPSG:4326
    return {
      ok: true,
      text: async () => "+proj=longlat +datum=WGS84 +no_defs",
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Create mock ZarrMultiscaleMetadata for testing
 */
function createMockMetadata(
  levels: Partial<ZarrLevelMetadata>[],
  options?: Partial<ZarrMultiscaleMetadata>,
): ZarrMultiscaleMetadata {
  const fullLevels = levels.map((level, idx) => ({
    path: level.path ?? String(idx),
    shape: level.shape ?? [1000, 1000],
    chunks: level.chunks ?? [256, 256],
    resolution: level.resolution ?? [1, 1],
    ...level,
  }));

  return {
    version: 3,
    format: "zarr-conventions",
    base: {
      path: fullLevels[fullLevels.length - 1]?.path ?? "0",
      shape: fullLevels[fullLevels.length - 1]?.shape ?? [1000, 1000],
      chunks: fullLevels[fullLevels.length - 1]?.chunks ?? [256, 256],
      dtype: "float32",
      fillValue: null,
      dimensions: ["lat", "lon"],
      spatialDimIndices: { x: 1, y: 0 },
    },
    levels: fullLevels as ZarrLevelMetadata[],
    crs: { code: "EPSG:4326", proj4def: null, source: "default" },
    bounds: null,
    latIsAscending: false,
    ...options,
  };
}

describe("parseZarrTileMatrixSet", () => {
  describe("level ordering", () => {
    it("should sort levels by resolution (coarsest first)", async () => {
      // Input: finest first (resolution ascending)
      const metadata = createMockMetadata([
        { path: "fine", shape: [4000, 4000], resolution: [0.25, 0.25] },
        { path: "medium", shape: [2000, 2000], resolution: [0.5, 0.5] },
        { path: "coarse", shape: [1000, 1000], resolution: [1, 1] },
      ]);

      const bounds: Bounds = [-180, -90, 180, 90];
      const formatDescriptor = createFormatDescriptor(metadata);

      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);

      // TMS should be coarsest first
      expect(result.sortedLevels[0]?.zarrPath).toBe("coarse");
      expect(result.sortedLevels[1]?.zarrPath).toBe("medium");
      expect(result.sortedLevels[2]?.zarrPath).toBe("fine");

      // TileMatrices should also be coarsest first
      // cellSize is computed from bounds/shape, not metadata resolution
      // bounds width = 360, so cellSize = 360 / shape[x]
      expect(result.tileMatrixSet.tileMatrices[0]?.cellSize).toBeCloseTo(0.36); // 360/1000
      expect(result.tileMatrixSet.tileMatrices[1]?.cellSize).toBeCloseTo(0.18); // 360/2000
      expect(result.tileMatrixSet.tileMatrices[2]?.cellSize).toBeCloseTo(0.09); // 360/4000
    });

    it("should handle already-sorted input (coarsest first)", async () => {
      // Input: coarsest first (resolution descending)
      const metadata = createMockMetadata([
        { path: "coarse", shape: [1000, 1000], resolution: [1, 1] },
        { path: "medium", shape: [2000, 2000], resolution: [0.5, 0.5] },
        { path: "fine", shape: [4000, 4000], resolution: [0.25, 0.25] },
      ]);

      const bounds: Bounds = [-180, -90, 180, 90];
      const formatDescriptor = createFormatDescriptor(metadata);

      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);

      expect(result.sortedLevels[0]?.zarrPath).toBe("coarse");
      expect(result.sortedLevels[2]?.zarrPath).toBe("fine");
    });

    it("should handle mixed resolution ordering", async () => {
      const metadata = createMockMetadata([
        { path: "medium", shape: [2000, 2000], resolution: [0.5, 0.5] },
        { path: "coarse", shape: [1000, 1000], resolution: [1, 1] },
        { path: "fine", shape: [4000, 4000], resolution: [0.25, 0.25] },
      ]);

      const bounds: Bounds = [-180, -90, 180, 90];
      const formatDescriptor = createFormatDescriptor(metadata);

      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);

      expect(result.sortedLevels[0]?.zarrPath).toBe("coarse");
      expect(result.sortedLevels[1]?.zarrPath).toBe("medium");
      expect(result.sortedLevels[2]?.zarrPath).toBe("fine");
    });
  });

  describe("geotransform computation", () => {
    it("should compute geotransform for latIsAscending=false (standard image)", async () => {
      const metadata = createMockMetadata([
        { path: "0", shape: [180, 360], resolution: [1, 1] },
      ]);

      const bounds: Bounds = [-180, -90, 180, 90];
      const formatDescriptor = createFormatDescriptor(metadata);

      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);
      const geotransform = result.tileMatrixSet.tileMatrices[0]?.geotransform;

      // [pixelWidth, 0, xMin, 0, -pixelHeight, yMax]
      expect(geotransform?.[0]).toBeCloseTo(1); // pixelWidth
      expect(geotransform?.[1]).toBe(0); // no rotation
      expect(geotransform?.[2]).toBeCloseTo(-180); // xMin
      expect(geotransform?.[3]).toBe(0); // no rotation
      expect(geotransform?.[4]).toBeCloseTo(-1); // -pixelHeight
      expect(geotransform?.[5]).toBeCloseTo(90); // yMax
    });

    it("should compute geotransform for latIsAscending=true", async () => {
      const metadata = createMockMetadata([
        { path: "0", shape: [180, 360], resolution: [1, 1] },
      ]);

      const bounds: Bounds = [-180, -90, 180, 90];
      const formatDescriptor = createFormatDescriptor(metadata);

      const result = await parseZarrTileMatrixSet(metadata, bounds, true, formatDescriptor);
      const geotransform = result.tileMatrixSet.tileMatrices[0]?.geotransform;

      // [pixelWidth, 0, xMin, 0, pixelHeight, yMin]
      expect(geotransform?.[0]).toBeCloseTo(1); // pixelWidth
      expect(geotransform?.[2]).toBeCloseTo(-180); // xMin
      expect(geotransform?.[4]).toBeCloseTo(1); // pixelHeight (positive)
      expect(geotransform?.[5]).toBeCloseTo(-90); // yMin
    });

    it("should compute geotransform from bounds even when spatial:transform is present", async () => {
      // Even when spatial:transform is provided in metadata, we compute geotransform
      // from authoritative bounds to ensure consistent pointOfOrigin across all levels
      const explicitTransform = [30, 0, 440720, 0, -30, 3751320] as number[];

      const metadata = createMockMetadata([
        {
          path: "0",
          shape: [1000, 1000],
          resolution: [30, 30],
          spatialTransform: explicitTransform,
        },
      ]);

      const bounds: Bounds = [440720, 3721320, 470720, 3751320];
      const formatDescriptor = createFormatDescriptor(metadata);

      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor, {
        crs: "EPSG:32632",
      });

      const geotransform = result.tileMatrixSet.tileMatrices[0]?.geotransform;

      // Geotransform is computed from bounds, not from the explicit transform
      // bounds width = 30000, shape = 1000, so cellSize = 30
      // origin = [xMin, yMax] for latIsAscending=false
      expect(geotransform?.[0]).toBeCloseTo(30); // cellSize X
      expect(geotransform?.[1]).toBe(0); // no rotation
      expect(geotransform?.[2]).toBeCloseTo(440720); // xMin
      expect(geotransform?.[3]).toBe(0); // no rotation
      expect(geotransform?.[4]).toBeCloseTo(-30); // -cellSize Y
      expect(geotransform?.[5]).toBeCloseTo(3751320); // yMax
    });

    it("should use consistent origin across all levels even when spatialTransform is present", async () => {
      // Simulate multiscale dataset where each level has slightly different
      // spatialTransform origins due to rounding during pyramid generation
      const metadata = createMockMetadata([
        {
          path: "coarse",
          shape: [125, 250],
          resolution: [8, 8],
          // Slightly different origin due to rounding
          spatialTransform: [240, 0, 440720.5, 0, -240, 3751319.5],
        },
        {
          path: "fine",
          shape: [1000, 2000],
          resolution: [1, 1],
          spatialTransform: [30, 0, 440720, 0, -30, 3751320],
        },
      ]);

      const bounds: Bounds = [440720, 3721320, 500720, 3751320];
      const formatDescriptor = createFormatDescriptor(metadata);

      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor, {
        crs: "EPSG:32632",
      });

      // All levels should share the same origin (from bounds), not from their spatialTransform
      const coarseMatrix = result.tileMatrixSet.tileMatrices[0]!;
      const fineMatrix = result.tileMatrixSet.tileMatrices[1]!;

      // pointOfOrigin should be identical for both levels
      expect(coarseMatrix.pointOfOrigin[0]).toBe(fineMatrix.pointOfOrigin[0]);
      expect(coarseMatrix.pointOfOrigin[1]).toBe(fineMatrix.pointOfOrigin[1]);

      // Origin should come from bounds, not from spatialTransform
      expect(coarseMatrix.pointOfOrigin[0]).toBeCloseTo(440720); // xMin
      expect(coarseMatrix.pointOfOrigin[1]).toBeCloseTo(3751320); // yMax
    });
  });

  describe("bounding box projection", () => {
    it("should compute WGS84 bounding box", async () => {
      const metadata = createMockMetadata([
        { path: "0", shape: [100, 100], resolution: [1, 1] },
      ]);

      const bounds: Bounds = [-10, 40, 10, 60]; // Part of Europe
      const formatDescriptor = createFormatDescriptor(metadata);

      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);

      const wgsBounds = result.tileMatrixSet.wgsBounds;
      expect(wgsBounds.lowerLeft[0]).toBeCloseTo(-10);
      expect(wgsBounds.lowerLeft[1]).toBeCloseTo(40);
      expect(wgsBounds.upperRight[0]).toBeCloseTo(10);
      expect(wgsBounds.upperRight[1]).toBeCloseTo(60);
    });
  });

  describe("tile matrix properties", () => {
    it("should compute matrixWidth and matrixHeight correctly", async () => {
      const metadata = createMockMetadata([
        { path: "0", shape: [1000, 2000], chunks: [256, 256], resolution: [1, 1] },
      ]);

      const bounds: Bounds = [0, 0, 2000, 1000];
      const formatDescriptor = createFormatDescriptor(metadata);

      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);
      const tileMatrix = result.tileMatrixSet.tileMatrices[0]!;

      expect(tileMatrix.tileWidth).toBe(256);
      expect(tileMatrix.tileHeight).toBe(256);
      expect(tileMatrix.matrixWidth).toBe(Math.ceil(2000 / 256)); // 8
      expect(tileMatrix.matrixHeight).toBe(Math.ceil(1000 / 256)); // 4
    });

    it("should use tileSize for ndpyramid-tiled format", async () => {
      const metadata = createMockMetadata(
        [{ path: "0", shape: [1000, 1000], chunks: [128, 128], resolution: [1, 1] }],
        { tileSize: 512 },
      );

      const bounds: Bounds = [0, 0, 1000, 1000];
      const formatDescriptor = createFormatDescriptor(metadata);

      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);
      const tileMatrix = result.tileMatrixSet.tileMatrices[0]!;

      expect(tileMatrix.tileWidth).toBe(512);
      expect(tileMatrix.tileHeight).toBe(512);
    });

    it("should compute scale denominator", async () => {
      const metadata = createMockMetadata([
        { path: "0", shape: [180, 360], resolution: [1, 1] },
      ]);

      const bounds: Bounds = [-180, -90, 180, 90];
      const formatDescriptor = createFormatDescriptor(metadata);

      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);
      const tileMatrix = result.tileMatrixSet.tileMatrices[0]!;

      // For 1 degree per pixel in WGS84
      // metersPerUnit ≈ 111319.49 (2 * π * 6378137 / 360)
      // scaleDenominator = (1 * 111319.49) / 0.00028 ≈ 397,569,605
      expect(tileMatrix.scaleDenominator).toBeGreaterThan(1e8);
      expect(tileMatrix.cellSize).toBeCloseTo(1);
    });
  });

  describe("CRS resolution", () => {
    it("should use user-provided CRS override", async () => {
      const metadata = createMockMetadata([
        { path: "0", shape: [1000, 1000], resolution: [30, 30] },
      ]);

      const bounds: Bounds = [0, 0, 30000, 30000];
      const formatDescriptor = createFormatDescriptor(metadata);

      await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor, {
        crs: "EPSG:32632",
      });

      // Should have called fetch with EPSG:32632
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("32632"),
      );
    });

    it("should use metadata CRS when no override provided", async () => {
      const metadata = createMockMetadata(
        [{ path: "0", shape: [1000, 1000], resolution: [1, 1] }],
        { crs: { code: "EPSG:3857", proj4def: null, source: "explicit" } },
      );

      const bounds: Bounds = [0, 0, 1000, 1000];
      const formatDescriptor = createFormatDescriptor(metadata);

      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);

      // EPSG:3857 has a built-in definition, so no fetch is needed
      // Just verify the CRS was used correctly by checking the projection units
      expect(result.tileMatrixSet.crs.coordinatesUnits).toBe("m");
    });

    it("should default to EPSG:4326 when no CRS info available", async () => {
      const metadata = createMockMetadata(
        [{ path: "0", shape: [180, 360], resolution: [1, 1] }],
        { crs: null },
      );

      const bounds: Bounds = [-180, -90, 180, 90];
      const formatDescriptor = createFormatDescriptor(metadata);

      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);

      // EPSG:4326 has a built-in definition, so no fetch is needed
      // Verify it defaulted to 4326 by checking the coordinate units
      expect(result.tileMatrixSet.crs.coordinatesUnits).toBe("degree");
    });
  });

  describe("non-uniform pyramid scaling", () => {
    it("should compute correct extent when X and Y scale differently", async () => {
      // Simulate USGS DEM-like pyramid: different X/Y scale factors due to rounding
      // when pyramid dimensions don't divide evenly
      const metadata = createMockMetadata([
        { path: "coarse", shape: [32, 77], resolution: [8192, 8192] },
        { path: "fine", shape: [256, 622], resolution: [1024, 1024] },
        { path: "finest", shape: [262913, 636928], resolution: [1, 1] },
      ]);

      const bounds: Bounds = [-125.6, 24.75, -66.6, 49.1];
      const formatDescriptor = createFormatDescriptor(metadata);
      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);

      const boundsX = bounds[2] - bounds[0];
      const boundsY = bounds[3] - bounds[1];

      // Each level should cover exactly the same bounds
      for (let i = 0; i < result.tileMatrixSet.tileMatrices.length; i++) {
        const tm = result.tileMatrixSet.tileMatrices[i]!;
        const level = result.sortedLevels[i]!;
        const xDimIdx = 1; // lon
        const yDimIdx = 0; // lat
        const width = level.level.shape[xDimIdx]!;
        const height = level.level.shape[yDimIdx]!;

        const computedX = width * Math.abs(tm.geotransform[0]);
        const computedY = height * Math.abs(tm.geotransform[4]);

        expect(computedX).toBeCloseTo(boundsX, 4);
        expect(computedY).toBeCloseTo(boundsY, 4);
      }
    });

    it("should handle asymmetric dimensions with different scale ratios", async () => {
      // Test case where X and Y have very different scale ratios
      // (e.g., 1000/100 = 10x vs 500/100 = 5x)
      const metadata = createMockMetadata([
        { path: "0", shape: [100, 100], resolution: [10, 5] },
        { path: "1", shape: [500, 1000], resolution: [1, 1] },
      ]);

      const bounds: Bounds = [0, 0, 100, 50];
      const formatDescriptor = createFormatDescriptor(metadata);
      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);

      const boundsX = bounds[2] - bounds[0];
      const boundsY = bounds[3] - bounds[1];

      // Both levels should cover the same bounds
      for (let i = 0; i < result.tileMatrixSet.tileMatrices.length; i++) {
        const tm = result.tileMatrixSet.tileMatrices[i]!;
        const level = result.sortedLevels[i]!;
        const width = level.level.shape[1]!; // x
        const height = level.level.shape[0]!; // y

        const computedX = width * Math.abs(tm.geotransform[0]);
        const computedY = height * Math.abs(tm.geotransform[4]);

        expect(computedX).toBeCloseTo(boundsX, 4);
        expect(computedY).toBeCloseTo(boundsY, 4);
      }
    });

    it("should handle single-pixel dimensions", async () => {
      const metadata = createMockMetadata([
        { path: "0", shape: [1, 100], resolution: [1, 1] },
      ]);
      const bounds: Bounds = [0, 0, 100, 1];
      const formatDescriptor = createFormatDescriptor(metadata);

      // Should not throw
      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);
      expect(result.tileMatrixSet.tileMatrices[0]).toBeDefined();

      const tm = result.tileMatrixSet.tileMatrices[0]!;
      // X extent should match bounds
      expect(100 * Math.abs(tm.geotransform[0])).toBeCloseTo(100, 4);
      // Y extent should match bounds
      expect(1 * Math.abs(tm.geotransform[4])).toBeCloseTo(1, 4);
    });

    it("should preserve exact bounds coverage across all pyramid levels", async () => {
      // Real-world scenario: pyramid where each level has 2x downsampling
      // but rounding causes small differences in scale factors
      const metadata = createMockMetadata([
        { path: "0", shape: [64, 128], resolution: [16, 16] },
        { path: "1", shape: [128, 257], resolution: [8, 8] },
        { path: "2", shape: [257, 513], resolution: [4, 4] },
        { path: "3", shape: [513, 1025], resolution: [2, 2] },
        { path: "4", shape: [1025, 2049], resolution: [1, 1] },
      ]);

      const bounds: Bounds = [-10, 40, 10, 50];
      const formatDescriptor = createFormatDescriptor(metadata);
      const result = await parseZarrTileMatrixSet(metadata, bounds, false, formatDescriptor);

      const boundsX = bounds[2] - bounds[0]; // 20
      const boundsY = bounds[3] - bounds[1]; // 10

      // Verify all levels cover exactly the same extent
      for (const tm of result.tileMatrixSet.tileMatrices) {
        const levelIdx = parseInt(tm.id);
        const level = result.sortedLevels[levelIdx]!;
        const width = level.level.shape[1]!;
        const height = level.level.shape[0]!;

        const computedX = width * Math.abs(tm.geotransform[0]);
        const computedY = height * Math.abs(tm.geotransform[4]);

        // Use 6 decimal places for precision
        expect(computedX).toBeCloseTo(boundsX, 6);
        expect(computedY).toBeCloseTo(boundsY, 6);
      }
    });
  });
});
