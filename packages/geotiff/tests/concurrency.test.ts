import { describe, expect, it } from "vitest";
import { mutex } from "../src/concurrency.js";

describe("mutex", () => {
  it("runs tasks one at a time", async () => {
    const lock = mutex();
    let active = 0;
    let maxActive = 0;

    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    };

    await Promise.all([lock(task), lock(task), lock(task), lock(task)]);

    expect(maxActive).toBe(1);
  });

  it("preserves submission order", async () => {
    const lock = mutex();
    const order: number[] = [];

    const promises = [1, 2, 3, 4, 5].map((n) =>
      lock(async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 5));
        order.push(n);
      }),
    );

    await Promise.all(promises);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it("delivers each task's result to its caller", async () => {
    const lock = mutex();
    const a = lock(async () => 1);
    const b = lock(async () => "two");
    const c = lock(async () => ({ three: 3 }));

    expect(await a).toBe(1);
    expect(await b).toBe("two");
    expect(await c).toEqual({ three: 3 });
  });

  it("does not block subsequent tasks when a task rejects", async () => {
    const lock = mutex();
    const failure = lock(async () => {
      throw new Error("boom");
    });
    const after = lock(async () => 42);

    await expect(failure).rejects.toThrow("boom");
    await expect(after).resolves.toBe(42);
  });

  it("propagates rejections only to the failing caller", async () => {
    const lock = mutex();
    const ok1 = lock(async () => "a");
    const bad = lock(async () => {
      throw new Error("nope");
    });
    const ok2 = lock(async () => "b");

    expect(await ok1).toBe("a");
    await expect(bad).rejects.toThrow("nope");
    expect(await ok2).toBe("b");
  });
});
