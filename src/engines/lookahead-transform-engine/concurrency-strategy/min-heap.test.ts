import { describe, it, expect } from "vitest";
import { MinHeap } from "./min-heap.ts";

const numericAsc = (a: number, b: number) => a - b;

describe("MinHeap", () => {
  it("reports size = 0 on empty heap", () => {
    const heap = new MinHeap<number>(numericAsc);
    expect(heap.size).toBe(0);
  });

  it("pop() on empty heap returns undefined", () => {
    const heap = new MinHeap<number>(numericAsc);
    expect(heap.pop()).toBeUndefined();
  });

  it("pushes and pops a single element", () => {
    const heap = new MinHeap<number>(numericAsc);
    heap.push(42);
    expect(heap.size).toBe(1);
    expect(heap.pop()).toBe(42);
    expect(heap.size).toBe(0);
  });

  it("returns minimum element from two-element heap, regardless of insertion order", () => {
    const a = new MinHeap<number>(numericAsc);
    a.push(5);
    a.push(1);
    expect(a.pop()).toBe(1);
    expect(a.pop()).toBe(5);

    const b = new MinHeap<number>(numericAsc);
    b.push(1);
    b.push(5);
    expect(b.pop()).toBe(1);
    expect(b.pop()).toBe(5);
  });

  it("returns elements in ascending order across a larger unsorted set", () => {
    const heap = new MinHeap<number>(numericAsc);
    const input = [9, 3, 7, 1, 8, 2, 6, 4, 5, 0];
    input.forEach((n) => heap.push(n));

    const out: number[] = [];
    while (heap.size > 0) out.push(heap.pop()!);

    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("respects a custom comparator (descending)", () => {
    const heap = new MinHeap<number>((a, b) => b - a);
    [3, 1, 4, 1, 5, 9, 2, 6].forEach((n) => heap.push(n));
    const out: number[] = [];
    while (heap.size > 0) out.push(heap.pop()!);
    expect(out).toEqual([9, 6, 5, 4, 3, 2, 1, 1]);
  });

  it("supports object elements with comparator over a field", () => {
    type E = { id: string; priority: number };
    const heap = new MinHeap<E>((a, b) => a.priority - b.priority);
    heap.push({ id: "a", priority: 3 });
    heap.push({ id: "b", priority: 1 });
    heap.push({ id: "c", priority: 2 });

    expect(heap.pop()!.id).toBe("b");
    expect(heap.pop()!.id).toBe("c");
    expect(heap.pop()!.id).toBe("a");
  });

  it("handles interleaved push/pop correctly", () => {
    const heap = new MinHeap<number>(numericAsc);
    heap.push(5);
    heap.push(3);
    expect(heap.pop()).toBe(3);
    heap.push(1);
    heap.push(4);
    expect(heap.pop()).toBe(1);
    expect(heap.pop()).toBe(4);
    expect(heap.pop()).toBe(5);
    expect(heap.pop()).toBeUndefined();
  });
});
