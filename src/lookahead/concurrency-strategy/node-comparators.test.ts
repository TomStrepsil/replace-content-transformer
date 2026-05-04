import { describe, it, expect } from "vitest";
import { breadthFirst, streamOrder } from "./node-comparators.ts";
import type { IterableSlotNode } from "../slot-tree/types.ts";
import { createIterableSlotNode } from "../../../test/utilities.ts";

const node = (
  siblingIndex: number,
  parent: IterableSlotNode | null = null
) => createIterableSlotNode(siblingIndex, parent);

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0);

describe("streamOrder", () => {
  it("returns 0 for the same node", () => {
    const n = node(0);
    expect(streamOrder(n, n)).toBe(0);
  });

  it("two root siblings: earlier siblingIndex wins", () => {
    const a = node(0);
    const c = node(2);
    expect(sign(streamOrder(a, c))).toBe(-1);
    expect(sign(streamOrder(c, a))).toBe(1);
  });

  it("ancestor vs descendant: ancestor wins (its chunks emit first)", () => {
    const a = node(0);
    const descendant = node(3, a); // child of a
    expect(sign(streamOrder(a, descendant))).toBe(-1);
    expect(sign(streamOrder(descendant, a))).toBe(1);
  });

  it("descendants of earlier sibling outrank later siblings at shallower depth", () => {
    const a = node(0);
    const c = node(2);
    const b = node(0, a); // nested in earlier sibling
    // B's chunks emit inside A's subtree, before C → B < C
    expect(sign(streamOrder(b, c))).toBe(-1);
    expect(sign(streamOrder(c, b))).toBe(1);
  });

  it("cousins: determined by their differing ancestor's siblingIndex", () => {
    const a = node(0);
    const d = node(3);
    const aChild = node(5, a); // deep inside a
    const dChild = node(0, d); // deep inside d
    // aChild's chain diverges from dChild's at root: a (0) vs d (3)
    expect(sign(streamOrder(aChild, dChild))).toBe(-1);
    expect(sign(streamOrder(dChild, aChild))).toBe(1);
  });

  it("same-parent nested: earlier sibling wins regardless of depth beyond", () => {
    const parent = node(0);
    const first = node(0, parent);
    const second = node(1, parent);
    expect(sign(streamOrder(first, second))).toBe(-1);
    expect(sign(streamOrder(second, first))).toBe(1);
  });
});

describe("breadthFirst", () => {
  it("shallower node always wins regardless of siblingIndex", () => {
    const root = node(10);
    const parent = node(0);
    const deep = node(0, parent);
    expect(sign(breadthFirst(root, deep))).toBe(-1);
    expect(sign(breadthFirst(deep, root))).toBe(1);
  });

  it("equal depth: earlier siblingIndex wins (tie-break)", () => {
    const a = node(0);
    const b = node(2);
    expect(sign(breadthFirst(a, b))).toBe(-1);
    expect(sign(breadthFirst(b, a))).toBe(1);
  });

  it("equal depth deeper: earlier siblingIndex wins", () => {
    const parent = node(0);
    const first = node(0, parent);
    const second = node(1, parent);
    expect(sign(breadthFirst(first, second))).toBe(-1);
  });

  it("returns 0 for identical depth and siblingIndex under equivalent parents", () => {
    const a = node(0);
    const b = node(0);
    expect(breadthFirst(a, b)).toBe(0);
  });
});
