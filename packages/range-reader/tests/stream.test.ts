import { describe, expect, it } from "vitest";
import { RangeStream } from "../src/stream.js";
import { fakeFetch, file, member, pattern } from "./helpers.js";

const MAX = 16 * 1024 * 1024;

describe("RangeStream", () => {
  describe("happy path", () => {
    it("resolves members in offset order as chunks arrive", async () => {
      const { fetch, next } = fakeFetch();
      const a = member(0, 10);
      const b = member(50, 20);
      const stream = new RangeStream(
        file(),
        { offset: 0, length: 100 },
        [a, b],
        {
          fetch,
          maxRequestBytes: MAX,
        },
      );
      const done = stream.run();
      const call = await next();
      expect(call.range).toBe("bytes=0-99");
      const body = call.reply({
        status: 206,
        headers: { "content-length": "100" },
      });
      await body.push(pattern(30));
      expect(await a.promise).toEqual({ kind: "bytes", bytes: pattern(10) });
      expect(stream.received).toBe(30);
      await body.push(pattern(70, 30));
      expect(await b.promise).toEqual({
        kind: "bytes",
        bytes: pattern(20, 50),
      });
      await body.close();
      const outcome = await done;
      expect(outcome).toMatchObject({ offset: 0, end: { kind: "complete" } });
      expect(outcome.bytes).toEqual(pattern(100));
      expect(stream.active).toBe(false);
    });

    it("merges init headers, sends the Range header and the cache mode", async () => {
      const { fetch, next } = fakeFetch();
      const stream = new RangeStream(
        file("https://x.test/a.tif", {
          headers: { authorization: "Bearer t" },
          credentials: "include",
        }),
        { offset: 10, length: 5 },
        [member(10, 5)],
        { fetch, maxRequestBytes: MAX, cacheMode: "no-store" },
      );
      void stream.run();
      const call = await next();
      expect(call.url).toBe("https://x.test/a.tif");
      expect(call.range).toBe("bytes=10-14");
      expect(new Headers(call.init.headers).get("authorization")).toBe(
        "Bearer t",
      );
      expect(call.init.credentials).toBe("include");
      expect(call.init.cache).toBe("no-store");
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
    });

    it("resolves an attached member when its bytes pass, at once when they already have", async () => {
      const { fetch, next } = fakeFetch();
      const a = member(0, 10);
      const stream = new RangeStream(file(), { offset: 0, length: 100 }, [a], {
        fetch,
        maxRequestBytes: MAX,
      });
      const done = stream.run();
      const body = (await next()).reply({
        status: 206,
        headers: { "content-length": "100" },
      });
      await body.push(pattern(30));

      const c = member(80, 10);
      expect(stream.attach(c)).toBe(true);
      const early = member(0, 5);
      expect(stream.attach(early)).toBe(true);
      expect(await early.promise).toEqual({ kind: "bytes", bytes: pattern(5) });
      expect(stream.attach(member(200, 1))).toBe(false);

      await body.push(pattern(70, 30));
      expect(await c.promise).toEqual({
        kind: "bytes",
        bytes: pattern(10, 80),
      });
      await body.close();
      await done;
      expect(stream.attach(member(0, 1))).toBe(false);
    });

    it("sends no Range header for a whole-object request and resolves its member at the end", async () => {
      const { fetch, next } = fakeFetch();
      const whole = member(0, 0);
      const stream = new RangeStream(file(), undefined, [whole], {
        fetch,
        maxRequestBytes: MAX,
      });
      const done = stream.run();
      const call = await next();
      expect(call.range).toBeNull();
      expect(stream.range).toBeUndefined();
      const body = call.reply({
        status: 200,
        headers: { "content-length": "40" },
      });
      await body.push(pattern(40));
      await body.close();
      expect(await whole.promise).toEqual({
        kind: "bytes",
        bytes: pattern(40),
      });
      expect(await done).toMatchObject({
        offset: 0,
        end: { kind: "complete" },
      });
    });

    it("sends bytes=-N for a suffix request and places it only when Content-Range says where", async () => {
      const placed = fakeFetch();
      const a = member(0, 0);
      const stream = new RangeStream(file(), { suffixLength: 16 }, [a], {
        fetch: placed.fetch,
        maxRequestBytes: MAX,
      });
      const done = stream.run();
      const call = await placed.next();
      expect(call.range).toBe("bytes=-16");
      const body = call.reply({
        status: 206,
        headers: { "content-length": "16", "content-range": "bytes 84-99/100" },
      });
      await body.push(pattern(16, 84));
      await body.close();
      expect(await a.promise).toEqual({
        kind: "bytes",
        bytes: pattern(16, 84),
      });
      expect(await done).toMatchObject({ offset: 84, size: 100 });

      const unplaced = fakeFetch();
      const b = member(0, 0);
      const stream2 = new RangeStream(file(), { suffixLength: 16 }, [b], {
        fetch: unplaced.fetch,
        maxRequestBytes: MAX,
      });
      const done2 = stream2.run();
      const body2 = (await unplaced.next()).reply({
        status: 206,
        headers: { "content-length": "16" },
      });
      await body2.push(pattern(16));
      await body2.close();
      const outcome = await done2;
      expect(outcome.offset).toBeUndefined();
      expect(outcome.size).toBeUndefined();
      expect(outcome.bytes).toEqual(pattern(16));
    });
  });
});
