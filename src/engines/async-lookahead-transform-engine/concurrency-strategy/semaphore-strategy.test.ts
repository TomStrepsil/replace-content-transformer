import { describe, it, expect } from "vitest";
import { setImmediate } from "node:timers/promises";
import { SemaphoreStrategy } from "./semaphore-strategy.ts";

describe("SemaphoreStrategy", () => {
  it("rejects concurrency < 1", () => {
    expect(() => new SemaphoreStrategy(0)).toThrow(RangeError);
  });

  it("acquire() resolves to a release function when capacity is available", async () => {
    const strategy = new SemaphoreStrategy(2);
    const release = await strategy.acquire();
    expect(typeof release).toBe("function");
    release();
  });

  it("blocks acquire() once the limit is saturated, and unblocks on release", async () => {
    const strategy = new SemaphoreStrategy(1);
    const releaseFirst = await strategy.acquire();

    let secondAcquired = false;
    const secondPromise = strategy
      .acquire()
      .then((release) => {
        secondAcquired = true;
        return release;
      });

    await setImmediate();
    expect(secondAcquired).toBe(false);

    releaseFirst();
    (await secondPromise)();
    expect(secondAcquired).toBe(true);
  });

  it("dispatches pending acquires in FIFO order", async () => {
    const strategy = new SemaphoreStrategy(1);
    const held = await strategy.acquire();

    const order: number[] = [];
    const releases = [1, 2, 3].map((i) =>
      strategy.acquire().then((release) => {
        order.push(i);
        return release;
      })
    );

    await setImmediate();
    expect(order).toEqual([]);

    held();
    (await releases[0])();
    (await releases[1])();
    (await releases[2])();
    expect(order).toEqual([1, 2, 3]);
  });

  it("release is idempotent", async () => {
    const strategy = new SemaphoreStrategy(1);
    const release = await strategy.acquire();
    release();
    release(); // should not add capacity beyond the original limit

    const next = await strategy.acquire();
    let extraAcquired = false;
    void strategy
      .acquire()
      .then(() => (extraAcquired = true));

    await setImmediate();
    expect(extraAcquired).toBe(false);
    next();
  });
});
