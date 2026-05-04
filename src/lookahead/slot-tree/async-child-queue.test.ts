import { describe, it, expect } from "vitest";
import { AsyncChildQueue } from "./async-child-queue.ts";
import type { SlotNode, TextSlotNode } from "./types.ts";
import { SLOT_KIND } from "./constants.ts";

function textNode(value: string, siblingIndex = 0): TextSlotNode {
  return { kind: SLOT_KIND.text, siblingIndex, value };
}

async function drain(queue: AsyncChildQueue): Promise<SlotNode[]> {
  const out: SlotNode[] = [];
  for await (const node of queue) out.push(node);
  return out;
}

describe("AsyncChildQueue", () => {
  it("iterates pushed nodes in order", async () => {
    const queue = new AsyncChildQueue(8);
    await queue.push(textNode("a", 0));
    await queue.push(textNode("b", 1));
    await queue.push(textNode("c", 2));
    queue.close();

    const drained = await drain(queue);
    expect(drained.map((n) => (n as TextSlotNode).value)).toEqual(["a", "b", "c"]);
  });

  it("push() resolves immediately when a consumer is already waiting", async () => {
    const queue = new AsyncChildQueue(1);
    const consumerResults: string[] = [];
    const consumerDone = (async () => {
      for await (const node of queue) {
        consumerResults.push((node as TextSlotNode).value);
        if (consumerResults.length === 2) break;
      }
    })();

    // Let the consumer suspend waiting for the first node
    await Promise.resolve();

    const pushStart = Date.now();
    await queue.push(textNode("first"));
    await queue.push(textNode("second"));
    const pushDuration = Date.now() - pushStart;

    await consumerDone;
    expect(consumerResults).toEqual(["first", "second"]);
    // Pushes should not have had to wait
    expect(pushDuration).toBeLessThan(50);
  });

  it("push() at the limit suspends until a node is consumed (backpressure)", async () => {
    const queue = new AsyncChildQueue(2);
    await queue.push(textNode("a"));
    await queue.push(textNode("b"));

    let thirdResolved = false;
    const thirdPush = queue.push(textNode("c")).then(() => {
      thirdResolved = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(thirdResolved).toBe(false);

    // Consume one — should unblock the third push
    const iter = queue[Symbol.asyncIterator]();
    const first = await iter.next();
    expect((first.value as TextSlotNode).value).toBe("a");

    await thirdPush;
    expect(thirdResolved).toBe(true);
  });

  it("close() terminates the async iterator cleanly", async () => {
    const queue = new AsyncChildQueue(4);
    await queue.push(textNode("only"));
    queue.close();

    const drained = await drain(queue);
    expect(drained).toHaveLength(1);
    expect((drained[0] as TextSlotNode).value).toBe("only");
  });

  it("close() while consumer is waiting resolves the iterator without hang", async () => {
    const queue = new AsyncChildQueue(4);
    const iter = queue[Symbol.asyncIterator]();
    const nextPromise = iter.next();

    // Let the consumer suspend
    await Promise.resolve();

    queue.close();
    const result = await nextPromise;
    expect(result.done).toBe(true);
  });

  it("supports multiple sequential push/consume cycles", async () => {
    const queue = new AsyncChildQueue(1);
    const iter = queue[Symbol.asyncIterator]();

    await queue.push(textNode("a"));
    expect((await iter.next()).value).toMatchObject({ value: "a" });

    await queue.push(textNode("b"));
    expect((await iter.next()).value).toMatchObject({ value: "b" });

    await queue.push(textNode("c"));
    expect((await iter.next()).value).toMatchObject({ value: "c" });

    queue.close();
    expect((await iter.next()).done).toBe(true);
  });
});
