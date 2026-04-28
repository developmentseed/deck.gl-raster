# Idea: Type-Split `GeoTIFF` by Georeferencing Mode

**Status:** Future work. Not part of v1 GCP rendering ([dev-docs/specs/2026-04-27-gcp-tileset-design.md](../specs/2026-04-27-gcp-tileset-design.md)). Captured here so the rationale isn't lost.

**Origin:** Surfaced while designing GCP COG support — adding GCPs to the existing `GeoTIFF` class would make `transform: Affine` viral (nullable everywhere) or force per-tile affine fitting (rejected as wasteful). The principled fix is to type-split the class hierarchy by georeferencing mode.

## The problem

`GeoTIFF` currently models one georeferencing mode: a single affine geotransform. Properties and types throughout `packages/geotiff` reflect this:

- `GeoTIFF.transform: Affine` (non-null)
- `Overview.transform: Affine`
- `RasterArray.transform: Affine`
- `Tile.array.transform: Affine` (built per-tile inside `fetchTile` by composing with the parent's affine)

A GeoTIFF georeferenced by Ground Control Points (or, eventually, Rational Polynomial Coefficients) doesn't have a single per-pixel affine. The forward map pixel → world is a fitted polynomial / TPS / rational function, evaluated at runtime.

For the GCP / RPC case, baking a per-tile affine into `Tile.array.transform` would mean fitting a local affine for every fetched tile. That's both expensive and conceptually wrong (the pixel grid isn't linear in CRS-space across a tile to begin with — the whole reason we use a non-linear model is that it isn't).

The alternatives within the existing single-class structure are all bad:

- Make `transform` nullable on `GeoTIFF`, `Overview`, `RasterArray`, and `Tile` → viral nullable check propagates to every consumer.
- Throw on `transform` access for non-affine COGs → the type system doesn't help; misuse becomes a runtime error.
- Return a degenerate identity affine for non-affine COGs → silently wrong; consumers compute garbage and don't know.

## The proposed shape

Type-split `GeoTIFF` (and `Overview`, `Tile`, `RasterArray`) into a discriminated class hierarchy whose abstract base holds shared logic. Each concrete subclass owns the georef-specific shape.

```ts
// ── packages/geotiff/src/array.ts ────────────────────────────────────────────

type RasterArrayCommon = {
  count: number;
  height: number;
  width: number;
  mask: Uint8Array | null;
  nodata: number | null;
  crs: number | ProjJson;
};

type AffineRasterArrayMeta = RasterArrayCommon & {
  kind: "affine";
  transform: Affine;
};

type GcpRasterArrayMeta = RasterArrayCommon & {
  kind: "gcp";
  // no transform — georef is implicit via the parent GcpGeoTIFF
};

type AffineRasterArray = AffineRasterArrayMeta & DecodedPixels;
type GcpRasterArray = GcpRasterArrayMeta & DecodedPixels;
type RasterArray = AffineRasterArray | GcpRasterArray;
```

```ts
// ── packages/geotiff/src/geotiff.ts ──────────────────────────────────────────

export abstract class GeoTIFF<TArr extends RasterArray = RasterArray> {
  // shared fields: tiff, image, maskImage, gkd, cachedTags, dataSource, gdalMetadata
  // shared accessors that don't depend on georef:
  //   crs, width, height, tileWidth/Height, tileCount, count, bbox, isTiled,
  //   storedStats, offsets, scales, nodata

  abstract readonly kind: "affine" | "gcp";
  abstract readonly overviews: ReadonlyArray<Overview<TArr>>;

  /** Subclasses build the per-tile array shape (with or without transform). */
  protected abstract _wrapTile(
    decoded: DecodedTileBytes,
    x: number,
    y: number,
  ): TArr;

  /** Shared decode-and-wrap. */
  async fetchTile(x: number, y: number, options?: FetchOptions): Promise<Tile<TArr>> {
    const decoded = await this._decodeTileBytes(x, y, options);
    return { x, y, array: this._wrapTile(decoded, x, y) };
  }

  // Static factories detect the variant and instantiate the right concrete class.
  static async fromUrl(...): Promise<AffineGeoTIFF | GcpGeoTIFF>;
  static async open(...): Promise<AffineGeoTIFF | GcpGeoTIFF>;
  static async fromArrayBuffer(...): Promise<AffineGeoTIFF | GcpGeoTIFF>;
  static async fromTiff(...): Promise<AffineGeoTIFF | GcpGeoTIFF>;
}

export class AffineGeoTIFF extends GeoTIFF<AffineRasterArray> {
  readonly kind = "affine" as const;
  readonly transform: Affine;
  readonly overviews: AffineOverview[];

  protected _wrapTile(decoded, x, y): AffineRasterArray {
    const tileTransform = compose(
      this.transform,
      translation(x * this.tileWidth, y * this.tileHeight),
    );
    return {
      kind: "affine",
      ...decoded,
      transform: tileTransform,
      crs: this.crs,
      count: this.count,
      // ...
    };
  }
}

export class GcpGeoTIFF extends GeoTIFF<GcpRasterArray> {
  readonly kind = "gcp" as const;
  readonly gcps: Gcp[];
  readonly overviews: GcpOverview[];

  protected _wrapTile(decoded, x, y): GcpRasterArray {
    return {
      kind: "gcp",
      ...decoded,
      crs: this.crs,
      count: this.count,
      // ...
    };
  }
}
```

`Tile` becomes generic: `type Tile<TArr> = { x: number; y: number; array: TArr }`.

`Overview` mirrors the same split — `AffineOverview` keeps its `transform: Affine`; `GcpOverview` does not. `Overview`'s `transform` getter currently scales the parent's transform; for the affine case this still works because `AffineOverview.geotiff` is typed as `AffineGeoTIFF` (not the abstract base).

`assembleTiles` tightens to take `Tile<AffineRasterArray>[]` and return `AffineRasterArray`. There is no `assembleTiles` for the GCP path in v1 — assembled GCP rasters don't have a single coherent affine, and the use case hasn't materialized yet.

## Why this is right

- **`RasterArray` is interpretable in isolation again.** Pixel data + the metadata that meaningfully accompanies it (georef when affine; just CRS when GCP). No more "transform present but not really".
- **The discriminator runs once.** Detect at file open; from there TypeScript narrows naturally for every downstream type.
- **Mirrors rasterio's transformer hierarchy.** Affine, GCP, and (eventually) RPC are sibling implementations of "things that map pixel ↔ world", with shared infrastructure for the mapping-agnostic parts (decode, tile fetch, mask handling).
- **Future-proof for RPCs.** Adding `RpcGeoTIFF / RpcRasterArray / RpcOverview` becomes additive — no further restructuring.

## Estimated cost

| Component | Effort | Notes |
|---|---|---|
| Split `RasterArray` into discriminated union with `kind` tag | S | ~30 LoC delta in [array.ts](../../packages/geotiff/src/array.ts) |
| Make `Tile` generic over array type | XS | ~5 LoC delta in [tile.ts](../../packages/geotiff/src/tile.ts) |
| Split `GeoTIFF` into abstract + 2 concrete subclasses | M | ~150 LoC delta in [geotiff.ts](../../packages/geotiff/src/geotiff.ts); static factories return the union |
| Split `Overview` similarly | M | ~80 LoC delta in [overview.ts](../../packages/geotiff/src/overview.ts) |
| Refactor `fetch.ts` to expose a `_decodeTileBytes` helper | S | ~30 LoC delta; the per-tile-affine bake step moves to `AffineGeoTIFF._wrapTile` |
| Tighten `assemble.ts` to affine-only | XS | ~5 LoC delta |
| Update `index.ts` exports | XS | Add `AffineGeoTIFF`, `GcpGeoTIFF`, variant types |
| Migrate consumers (`cog-layer.ts`, `multi-cog-layer.ts`, examples, tests) | S–M | One `instanceof AffineGeoTIFF` / `kind === "affine"` check at the top of any code that touches `geotiff.transform` or `tile.array.transform` |

**Total: probably 4–6 hours of focused work** plus consumer migration. The bulk of the risk is in static-factory return-type plumbing — making sure `GeoTIFF.open()` consumers get good narrowing without explicit type annotations.

## When to do this

- When v1 GCP rendering ships and we have a working baseline against which to measure migration regressions.
- When demand for assembled GCP rasters (or any code path that wants to produce / consume a GCP-flavored `RasterArray`) materializes.
- When RPC support is on the horizon — the type-split eliminates the alternative of a third nullable property.

## Why we deferred it

The v1 GCP rendering path doesn't need polymorphic `RasterArray`. The COGLayer fetches tiles per-position and routes them through a render pipeline that operates on pixel data + the per-tile `forwardTransform` / `inverseTransform` callbacks supplied by `GcpTilesetLevel.tileTransform(x, y)`. `Tile.array.transform` isn't read on the GCP path. So we can ship rendering with a smaller surface-area change (see the v1 spec) and revisit the type-split when more code paths need first-class GCP-data handling.
