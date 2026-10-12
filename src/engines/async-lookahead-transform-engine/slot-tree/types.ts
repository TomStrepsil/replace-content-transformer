import { SLOT_KIND } from "./constants.ts";

/**
 * The tree-position descriptor for an iterable slot.
 *
 * This is the type exposed to {@link ConcurrencyStrategy} implementors and
 * {@link NodeComparator} authors — it contains exactly the fields needed to
 * determine scheduling order and nothing about the slot's content.
 */
export interface SlotTreeNode {
  readonly siblingIndex: number;
  readonly depth: number;
  readonly parent: SlotTreeNode | null;
}

/**
 * A passthrough slot — a literal string that appears in the output at a
 * fixed position in the stream order.
 *
 * Text slots are emitted directly by the drain loop and never pass
 * through the {@link ConcurrencyStrategy}, so — unlike
 * {@link IterableSlotNode} — they carry no `parent` pointer: tree-aware
 * ordering applies only to scheduled iterable work.
 */
export interface TextSlotNode {
  readonly kind: typeof SLOT_KIND.text;
  readonly siblingIndex: number;
  readonly value: string;
}

import type { Nested } from "../nested.ts";

/**
 * A slot whose content is produced by an async iterable, or by a
 * {@link Nested} marker signalling that the replacement's output should
 * be re-scanned by a child transformer.
 *
 * Extends {@link SlotTreeNode} with the engine-internal fields for content
 * production. The `ConcurrencyStrategy` receives only the {@link SlotTreeNode}
 * projection; `iterable` and `getOriginalContent` are not part of the
 * scheduling contract.
 *
 * The `iterable` promise is resolved by the engine once the
 * `ConcurrencyStrategy` has granted a slot and the replacement function
 * has returned. The slot itself is held through the iterable's
 * production (released when the producer pulls `done: true`), or
 * released immediately on `Nested` handoff or replacement-fn rejection.
 */
export interface IterableSlotNode extends SlotTreeNode {
  readonly kind: typeof SLOT_KIND.iterable;
  /** Lazily produces the original match text; called by the drain loop only if abandonPendingSignal is aborted. */
  readonly getOriginalContent?: () => string;
  /**
   * Assigned by the engine immediately after construction. `undefined` only
   * during the two-statement staged init in `#scheduleMatch` (the node
   * reference is needed to wire the promise that depends on it). Never
   * read before assignment.
   */
  iterable: Promise<AsyncIterable<string> | Nested> | undefined;
}

export type SlotNode = TextSlotNode | IterableSlotNode;
