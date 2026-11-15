import { describe, it, expect } from "vitest";
import { Semaphore } from "./semaphore.ts";

describe("Semaphore", () => {
  it("allows up to `concurrency` simultaneous acquirers without suspending", async () => {
    const semaphore = new Semaphore(3);

    // Three immediate acquires should all resolve without releases
    await Promise.all([
      semaphore.acquire(),
      semaphore.acquire(),
      semaphore.acquire()
    ]);

    // If we got here, all three resolved — pass
    expect(true).toBe(true);
  });

  it("suspends the (concurrency + 1)th acquire() until release() is called", async () => {
    const semaphore = new Semaphore(2);

    await semaphore.acquire();
    await semaphore.acquire();

    let thirdResolved = false;
    const thirdAcquire = semaphore.acquire().then(() => {
      thirdResolved = true;
    });

    // Let microtasks settle; third should still be pending
    await Promise.resolve();
    await Promise.resolve();
    expect(thirdResolved).toBe(false);

    semaphore.release();
    await thirdAcquire;
    expect(thirdResolved).toBe(true);
  });

  it("wakes waiters in FIFO order", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire(); // occupy the single slot

    const order: number[] = [];
    const first = semaphore.acquire().then(() => order.push(1));
    const second = semaphore.acquire().then(() => order.push(2));
    const third = semaphore.acquire().then(() => order.push(3));

    semaphore.release();
    semaphore.release();
    semaphore.release();

    await Promise.all([first, second, third]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("works correctly with concurrency = 1 (mutex)", async () => {
    const semaphore = new Semaphore(1);
    const log: string[] = [];

    async function criticalSection(label: string, delayMs: number) {
      await semaphore.acquire();
      log.push(`enter-${label}`);
      await new Promise((r) => setTimeout(r, delayMs));
      log.push(`exit-${label}`);
      semaphore.release();
    }

    await Promise.all([
      criticalSection("a", 5),
      criticalSection("b", 1),
      criticalSection("c", 1)
    ]);

    // Entries and exits must alternate — no overlap
    expect(log).toEqual([
      "enter-a",
      "exit-a",
      "enter-b",
      "exit-b",
      "enter-c",
      "exit-c"
    ]);
  });

  it("does not invoke a waiter on release() when no waiter is queued", async () => {
    const semaphore = new Semaphore(1);
    await semaphore.acquire();

    // Releasing before any waiter has queued must not produce a phantom
    // resolution. We cannot observe "no call" directly, so we verify that
    // a subsequently queued waiter is resolved by a *subsequent* release,
    // not retroactively by the earlier one.
    semaphore.release();
    semaphore.release();

    let resolvedAt: number | null = null;
    let marker = 0;
    const waiterPromise = (async () => {
      // Fill up capacity first so the next acquire must wait
      await semaphore.acquire();
      await semaphore.acquire();
      const pending = semaphore.acquire().then(() => {
        resolvedAt = marker;
      });
      marker = 1; // marker set AFTER the pending acquire is queued
      await Promise.resolve();
      await Promise.resolve();
      expect(resolvedAt).toBeNull();
      marker = 2;
      semaphore.release();
      await pending;
    })();

    await waiterPromise;
    expect(resolvedAt).toBe(2); // resolved only after explicit release, not retroactively
  });
});
