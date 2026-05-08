import { SLOT_KIND } from "./constants.ts";

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
 * The `iterable` promise is resolved by the engine once the
 * `ConcurrencyStrategy` has granted a slot and the replacement function
 * has returned. The slot itself is held through the iterable's
 * production (released when the producer pulls `done: true`), or
 * released immediately on `Nested` handoff or replacement-fn rejection.
 */
export interface IterableSlotNode {
  readonly kind: typeof SLOT_KIND.iterable;
  readonly siblingIndex: number;
  readonly parent: IterableSlotNode | null;
  /** Lazily produces the original match text; called by the drain loop only if abandonPendingSignal is aborted. */
  readonly getOriginalContent?: () => string;
  /**
   * Set by the engine immediately after the node is constructed.
   * Never read before `iterable` is assigned, but typed as possibly
   * `undefined` to satisfy the staged construction (the engine needs
   * the node reference to wire the promise that depends on it).
   */
  iterable: Promise<AsyncIterable<string> | Nested>;
}

export type SlotNode = TextSlotNode | IterableSlotNode;
