import type { IterableSlotNode } from "../slot-tree/types.ts";

/**
 * A comparison function over two {@link IterableSlotNode}s, following the
 * {@link Array.prototype.sort} convention:
 *
 * - negative if `a` has higher priority (should dispatch before `b`)
 * - positive if `b` has higher priority
 * - zero if equivalent
 */
export type NodeComparator = (a: IterableSlotNode, b: IterableSlotNode) => number;

/**
 * Compare by tree depth — shallower nodes (closer to root) first.
 *
 * All level-N slots dispatch before any level-N+1 slot, regardless of
 * their position in the output stream. Ties (equal depth) are broken by
 * {@link IterableSlotNode.siblingIndex}.
 *
 * Useful when the input has many independent sibling sections of equal
 * weight and you want all sources to begin work simultaneously before
 * the scheduler starts nested work.
 */
export const breadthFirst: NodeComparator = (a, b) => {
  const depthDelta = a.depth - b.depth;
  if (depthDelta !== 0) return depthDelta;
  return a.siblingIndex - b.siblingIndex;
};

/**
 * Compare by pre-order position in the slot tree — i.e. the order in
 * which chunks will actually emit to the output stream.
 *
 * Uses lowest-common-ancestor: equalise depths, then walk both nodes up
 * together until they share a parent, and compare sibling indices at
 * that level.
 *
 * Depth is an O(1) field read; the LCA walk is O(min(depthA, depthB)),
 * typically O(3–10). Best default when earlier-in-stream content matters
 * more than later content.
 */
export const streamOrder: NodeComparator = (a, b) => {
  if (a === b) return 0;

  let cursorA: IterableSlotNode = a;
  let cursorB: IterableSlotNode = b;
  let depthA = a.depth;
  let depthB = b.depth;

  // Walk the deeper node up until depths match.
  while (depthA > depthB) {
    // If we hit b on the way up, a is a descendant of b → b wins.
    if (cursorA.parent === null) break;
    cursorA = cursorA.parent;
    depthA--;
    if (cursorA === cursorB) return 1; // a was descendant of b
  }
  while (depthB > depthA) {
    if (cursorB.parent === null) break;
    cursorB = cursorB.parent;
    depthB--;
    if (cursorA === cursorB) return -1; // b was descendant of a
  }

  // Walk both up together until siblings share a parent.
  while (cursorA.parent !== cursorB.parent) {
    cursorA = cursorA.parent!;
    cursorB = cursorB.parent!;
  }

  return cursorA.siblingIndex - cursorB.siblingIndex;
};
