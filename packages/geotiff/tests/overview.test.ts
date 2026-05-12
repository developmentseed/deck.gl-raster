import type { TiffImage } from "@cogeotiff/core";
import { TiffTag } from "@cogeotiff/core";
import { describe, expect, it } from "vitest";
import { Overview } from "../src/overview.js";

/**
 * A minimal fake TiffImage that counts calls to `fetch` per tag.
 *
 * Only the methods/fields actually used by `ensureTagsLoaded` need to work;
 * everything else is stubbed since these tests don't call `fetchTile`.
 */
function makeFakeImage(): {
  image: TiffImage;
  fetchCalls: () => Map<number, number>;
} {
  const calls = new Map<number, number>();
  const image = {
    fetch: async (tag: number) => {
      calls.set(tag, (calls.get(tag) ?? 0) + 1);
      return null;
    },
  } as unknown as TiffImage;
  return { image, fetchCalls: () => calls };
}

describe("Overview.ensureTagsLoaded", () => {
  it("bulk-fetches TileOffsets and TileByteCounts on first call", async () => {
    const data = makeFakeImage();
    const overview = new Overview(
      {} as never, // geotiff
      {} as never, // gkd
      data.image,
      null,
      {} as never, // cachedTags
      { fetch: async () => new ArrayBuffer(0) }, // dataSource
    );

    await overview.ensureTagsLoaded();

    const calls = data.fetchCalls();
    expect(calls.get(TiffTag.TileOffsets)).toBe(1);
    expect(calls.get(TiffTag.TileByteCounts)).toBe(1);
  });

  it("memoizes: a second call does not refetch", async () => {
    const data = makeFakeImage();
    const overview = new Overview(
      {} as never,
      {} as never,
      data.image,
      null,
      {} as never,
      { fetch: async () => new ArrayBuffer(0) },
    );

    await overview.ensureTagsLoaded();
    await overview.ensureTagsLoaded();
    await overview.ensureTagsLoaded();

    const calls = data.fetchCalls();
    expect(calls.get(TiffTag.TileOffsets)).toBe(1);
    expect(calls.get(TiffTag.TileByteCounts)).toBe(1);
  });

  it("dedupes concurrent first-call invocations into one underlying load", async () => {
    const data = makeFakeImage();
    const overview = new Overview(
      {} as never,
      {} as never,
      data.image,
      null,
      {} as never,
      { fetch: async () => new ArrayBuffer(0) },
    );

    await Promise.all([
      overview.ensureTagsLoaded(),
      overview.ensureTagsLoaded(),
      overview.ensureTagsLoaded(),
    ]);

    const calls = data.fetchCalls();
    expect(calls.get(TiffTag.TileOffsets)).toBe(1);
    expect(calls.get(TiffTag.TileByteCounts)).toBe(1);
  });

  it("also fetches mask tags when a mask IFD is present", async () => {
    const data = makeFakeImage();
    const mask = makeFakeImage();
    const overview = new Overview(
      {} as never,
      {} as never,
      data.image,
      mask.image,
      {} as never,
      { fetch: async () => new ArrayBuffer(0) },
    );

    await overview.ensureTagsLoaded();

    expect(data.fetchCalls().get(TiffTag.TileOffsets)).toBe(1);
    expect(data.fetchCalls().get(TiffTag.TileByteCounts)).toBe(1);
    expect(mask.fetchCalls().get(TiffTag.TileOffsets)).toBe(1);
    expect(mask.fetchCalls().get(TiffTag.TileByteCounts)).toBe(1);
  });
});
