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
import type { Utf8Bytes } from "../../types.ts";

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
 * The `iterable` promise is resolved by the engine, to the replacement
 * itself, unread, once the `ConcurrencyStrategy` has granted a slot and the
 * replacement function has returned. The slot is held while the drain loop
 * reads the replacement, and released when that read ends, however it ends:
 * `done`, an error, an early exit or `cancel()`. It is released immediately
 * on `Nested` handoff, replacement-fn rejection, `cancel()`, or an
 * `abandonPendingSignal` abort before the drain loop reaches the slot.
 */
export interface IterableSlotNode extends SlotTreeNode {
  readonly kind: typeof SLOT_KIND.iterable;
  /** Lazily produces the original match text; called by the drain loop when the slot is abandoned, or when stopReplacingSignal aborted before its replacement was called. */
  readonly getOriginalContent?: () => string;
  /**
   * Assigned by the engine immediately after construction. `undefined` only
   * during the two-statement staged init in `#scheduleMatch` (the node
   * reference is needed to wire the promise that depends on it). Never
   * read before assignment.
   */
  iterable: Promise<AsyncIterable<string | Utf8Bytes> | Nested<string | Utf8Bytes>> | undefined;
}

export type SlotNode = TextSlotNode | IterableSlotNode;
