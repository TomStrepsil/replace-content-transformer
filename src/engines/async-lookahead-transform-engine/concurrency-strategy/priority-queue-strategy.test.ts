import { describe, it, expect } from "vitest";
import { PriorityQueueStrategy } from "./priority-queue-strategy.ts";
import { breadthFirst, streamOrder } from "./node-comparators.ts";
import {
  createIterableSlotNode,
  settleMicrotasks
} from "../../../../test/utilities.ts";

describe("PriorityQueueStrategy", () => {
  it("rejects concurrency < 1", () => {
    expect(() => new PriorityQueueStrategy(0)).toThrow(RangeError);
  });

  it("acquire() resolves to a release function when capacity is available", async () => {
    const strategy = new PriorityQueueStrategy(2);
    const release = await strategy.acquire(createIterableSlotNode(0, null));
    expect(typeof release).toBe("function");
    release();
  });

  it("respects concurrency limit", async () => {
    const strategy = new PriorityQueueStrategy(2);
    const releaseA = await strategy.acquire(createIterableSlotNode(0, null));
    const releaseB = await strategy.acquire(createIterableSlotNode(1, null));

    let thirdAcquired = false;
    const third = strategy
      .acquire(createIterableSlotNode(2, null))
      .then((release) => {
        thirdAcquired = true;
        return release;
      });

    await settleMicrotasks(3);
    expect(thirdAcquired).toBe(false);

    releaseA();
    (await third)();
    releaseB();
  });

  it("grants higher-priority waiters first under streamOrder", async () => {
    const strategy = new PriorityQueueStrategy(1, streamOrder);
    const aNode = createIterableSlotNode(0, null);
    const releaseA = await strategy.acquire(aNode);

    // c is a later root sibling; b is nested in a.
    // streamOrder ranks b (child of earlier a) before c.
    const c = createIterableSlotNode(2, null);
    const b = createIterableSlotNode(0, aNode);
    const order: string[] = [];
    const releaseC = strategy.acquire(c).then((release) => {
      order.push("c");
      return release;
    });
    const releaseB = strategy.acquire(b).then((release) => {
      order.push("b");
      return release;
    });

    releaseA();
    (await releaseB)();
    (await releaseC)();

    expect(order).toEqual(["b", "c"]);
  });

  it("grants shallower waiters first under breadthFirst", async () => {
    const strategy = new PriorityQueueStrategy(1, breadthFirst);
    const aNode = createIterableSlotNode(0, null);
    const releaseA = await strategy.acquire(aNode);

    const nested = createIterableSlotNode(0, aNode); // deeper
    const sibling = createIterableSlotNode(5, null); // shallower, later index
    const order: string[] = [];
    const releaseNested = strategy.acquire(nested).then((release) => {
      order.push("nested");
      return release;
    });
    const releaseSibling = strategy.acquire(sibling).then((release) => {
      order.push("sibling");
      return release;
    });

    releaseA();
    (await releaseSibling)();
    (await releaseNested)();

    expect(order).toEqual(["sibling", "nested"]);
  });

  it("release is idempotent", async () => {
    const strategy = new PriorityQueueStrategy(1);
    const release = await strategy.acquire(createIterableSlotNode(0, null));
    release();
    release();

    const next = await strategy.acquire(createIterableSlotNode(1, null));
    let extraAcquired = false;
    void strategy
      .acquire(createIterableSlotNode(2, null))
      .then(() => (extraAcquired = true));

    await settleMicrotasks(3);
    expect(extraAcquired).toBe(false);
    next();
  });
});
